import { expect } from 'chai';

import { csvCell, detectDelimiter, parseCsv, writeCsv } from '../src/csv';
import { Translator } from '../src/i18n';
import {
  guessMapping,
  pointerResolver,
  prepareRows,
  templateHeaders,
  unmappedRequired,
  type ImportField,
} from '../src/importer';

/** Attributes laid out like the Twake user schema's. */
const fields: ImportField[] = [
  [
    'employeeNumber',
    { type: 'string', required: true, label: { en: 'Employee ID' } },
  ],
  ['cn', { type: 'string', label: { en: 'Common name', fr: 'Nom commun' } }],
  ['sn', { type: 'string', required: true, label: { en: 'Last name' } }],
  [
    'givenName',
    { type: 'string', required: true, label: { en: 'First name' } },
  ],
  [
    'displayName',
    { type: 'string', required: true, label: { en: 'Full name' } },
  ],
  [
    'personalTitle',
    {
      type: 'pointer',
      branch: ['ou=twakeTitle,ou=nomenclature,dc=example,dc=com'],
      label: { en: 'Title', fr: 'Civilité' },
    },
  ],
  [
    'title',
    {
      type: 'pointer',
      branch: ['ou=positions,dc=example,dc=com'],
      label: { en: 'Position', fr: 'Poste' },
    },
  ],
  [
    'mail',
    {
      type: 'string',
      required: true,
      test: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      hint: 'Expected an email address',
      label: { en: 'Email' },
    },
  ],
  [
    'mailAlternateAddress',
    {
      type: 'array',
      items: { type: 'string' },
      label: { en: 'Email aliases' },
    },
  ],
  ['telephoneNumber', { type: 'string', label: { en: 'Phone' } }],
  ['mobile', { type: 'string', label: { en: 'Mobile' } }],
  ['postalAddress', { type: 'string', label: { en: 'Address' } }],
  ['postalCode', { type: 'string', label: { en: 'Zip code' } }],
  ['l', { type: 'string', label: { en: 'Locality' } }],
  ['pwdReset', { type: 'boolean', label: { en: 'Password reset required' } }],
  [
    'twakeDepartmentLink',
    {
      type: 'pointer',
      required: true,
      branch: ['dc=example,dc=com'],
      label: { en: 'Department' },
    },
  ],
  ['twakeDeletionDate', { type: 'date', label: { en: 'Deletion date' } }],
];

const titles = [
  { dn: 'cn=Mr,ou=twakeTitle,ou=nomenclature,dc=example,dc=com', label: 'Mr' },
  {
    dn: 'cn=Mrs,ou=twakeTitle,ou=nomenclature,dc=example,dc=com',
    label: 'Mrs',
  },
];
const departments = [
  { dn: 'ou=Gov,ou=organization,dc=example,dc=com', label: 'Republic / Gov' },
  {
    dn: 'ou=Finance,ou=Gov,ou=organization,dc=example,dc=com',
    label: 'Republic / Gov / Ministry of Finance',
  },
];

describe('CSV import', () => {
  describe('parseCsv', () => {
    it('should find the separator a spreadsheet of any locale used', () => {
      expect(detectDelimiter('a;b;c')).to.equal(';');
      expect(detectDelimiter('a,b,c')).to.equal(',');
      expect(detectDelimiter('a\tb\tc')).to.equal('\t');
      // Separators inside quotes are not counted.
      expect(detectDelimiter('"a;b;c",d,e')).to.equal(',');
    });

    it('should read quotes, byte-order marks and Windows line ends', () => {
      const table = parseCsv(
        '\uFEFFName;Comment\r\n"Doe; Jane";"She said ""hi""\r\nthen left"\r\n\r\nSmith;\r\n'
      );
      expect(table.delimiter).to.equal(';');
      expect(table.headers).to.deep.equal(['Name', 'Comment']);
      expect(table.rows).to.deep.equal([
        ['Doe; Jane', 'She said "hi"\r\nthen left'],
        ['Smith', ''],
      ]);
    });

    it('should read back what it writes', () => {
      const rows = [
        ['Name', 'Formula'],
        ['Doe; Jane', '=1+1'],
      ];
      const table = parseCsv(writeCsv(rows, ';'));
      expect(table.headers).to.deep.equal(rows[0]);
      // The apostrophe that keeps a spreadsheet from running it stays.
      expect(table.rows).to.deep.equal([['Doe; Jane', "'=1+1"]]);
    });

    it('should quote a cell holding the separator in use', () => {
      expect(csvCell('a;b', ';')).to.equal('"a;b"');
      expect(csvCell('a;b', ',')).to.equal('a;b');
    });
  });

  describe('guessMapping', () => {
    it('should match the columns of an existing export by their labels', () => {
      // The header row of the files administrators already have.
      const headers = [
        'Employee ID',
        'Common name',
        'Full name',
        'Title of civility',
        'Last name',
        'First name',
        'Email address',
        'Department',
        'Position in the department',
        'Comment',
        'Postal address',
        'Zip code',
        'City',
        'Mobile number',
        'Phone number',
        'Email quota size',
      ];
      expect(guessMapping(headers, fields)).to.deep.equal([
        'employeeNumber',
        'cn',
        'displayName',
        // A label counts for more than an attribute name: `Title` is
        // personalTitle's label and only title's name.
        'personalTitle',
        'sn',
        'givenName',
        // Two columns start with `Email`: neither is guessed.
        '',
        'twakeDepartmentLink',
        'title',
        '',
        'postalAddress',
        'postalCode',
        '',
        'mobile',
        'telephoneNumber',
        '',
      ]);
    });

    it('should match attribute names and labels in any language or case', () => {
      expect(
        guessMapping(['MAIL', 'civilité', 'nom_commun', 'unknown'], fields)
      ).to.deep.equal(['mail', 'personalTitle', 'cn', '']);
    });

    it('should name the required attributes no column fills', () => {
      const mapping = guessMapping(['Email', 'Last name'], fields);
      expect(unmappedRequired(mapping, fields)).to.deep.equal([
        'employeeNumber',
        'givenName',
        'displayName',
        'twakeDepartmentLink',
      ]);
    });

    it('should head a template with the labels of the language', () => {
      expect(templateHeaders(fields.slice(0, 2), 'fr')).to.deep.equal([
        'Employee ID',
        'Nom commun',
      ]);
    });
  });

  describe('pointerResolver', () => {
    it('should find an entry by its name, its path or its DN', () => {
      const resolve = pointerResolver(departments);
      const finance = departments[1].dn;
      expect(resolve('Republic / Gov / Ministry of Finance').dn).to.equal(
        finance
      );
      // A path is typed with or without spaces around the separator.
      expect(resolve('republic/gov/ministry of finance').dn).to.equal(finance);
      expect(resolve(finance.toUpperCase()).dn).to.equal(finance);
      // The value of its RDN, as a file exported from the directory has it.
      expect(resolve('Finance').dn).to.equal(finance);
      expect(resolve('Health')).to.deep.equal({});
    });

    it('should refuse a name two entries share rather than pick one', () => {
      const resolve = pointerResolver([
        { dn: 'ou=Audit,ou=A,dc=example,dc=com', label: 'Audit' },
        { dn: 'ou=Audit,ou=B,dc=example,dc=com', label: 'Audit' },
      ]);
      expect(resolve('Audit')).to.deep.equal({ ambiguous: true });
    });
  });

  describe('prepareRows', () => {
    const translator = new Translator('en');
    const headers = [
      'Employee ID',
      'Last name',
      'First name',
      'Full name',
      'Title',
      'Email',
      'Email aliases',
      'Department',
      'Password reset required',
      'Deletion date',
    ];
    const mapping = guessMapping(headers, fields);
    const resolvers = {
      personalTitle: pointerResolver(titles),
      twakeDepartmentLink: pointerResolver(departments),
    };
    const prepare = (rows: string[][]) =>
      prepareRows(
        { headers, rows, delimiter: ';' },
        mapping,
        fields,
        resolvers,
        translator
      );

    it('should build what the form would send', () => {
      const [row] = prepare([
        [
          'E1',
          'Doe',
          'Jane',
          'Jane Doe',
          'mrs',
          'jane@example.org',
          'j.doe@example.org | jd@example.org',
          'Republic / Gov / Ministry of Finance',
          'yes',
          '30/09/2027',
        ],
      ]);
      expect(row.errors).to.deep.equal([]);
      expect(row.line).to.equal(2);
      expect(row.values).to.deep.equal({
        employeeNumber: 'E1',
        sn: 'Doe',
        givenName: 'Jane',
        displayName: 'Jane Doe',
        personalTitle: titles[1].dn,
        mail: 'jane@example.org',
        mailAlternateAddress: ['j.doe@example.org', 'jd@example.org'],
        twakeDepartmentLink: departments[1].dn,
        pwdReset: 'TRUE',
        twakeDeletionDate: '20270930000000Z',
      });
    });

    it('should say everything wrong with a row, in words', () => {
      const [row] = prepare([
        [
          'E2',
          'Doe',
          '',
          'Jane Doe',
          'Sir',
          'not an address',
          '',
          'Health',
          'maybe',
          'soon',
        ],
      ]);
      expect(row.errors).to.deep.equal([
        'Title: “Sir” not found',
        'Email: Expected an email address',
        'Department: “Health” not found',
        'Password reset required: “maybe” is neither yes nor no',
        'Deletion date: “soon” is not a date',
        // Email and Department were refused above: they are not reported a
        // second time as missing.
        'First name is required',
      ]);
    });

    it('should refuse a row repeating a unique value of an earlier one', () => {
      const unique: ImportField[] = fields.map(([name, attr]) => {
        if (name === 'mail')
          return [
            name,
            { ...attr, unique: { attributes: ['mailAlternateAddress'] } },
          ];
        if (name === 'mailAlternateAddress')
          return [name, { ...attr, unique: { attributes: ['mail'] } }];
        return [name, attr];
      });
      const row = (id: string, mail: string, alias = ''): string[] => [
        id,
        'Doe',
        'Jane',
        'Jane Doe',
        '',
        mail,
        alias,
        'Republic / Gov',
        '',
        '',
      ];
      const rows = prepareRows(
        {
          headers,
          rows: [
            row('E1', 'jane@example.org'),
            // The same address, in another case: an address is one address.
            row('E2', 'JANE@example.org'),
            // Used as an alias: the namespace is shared.
            row('E3', 'other@example.org', 'jane@example.org'),
            // The identifier names the entry: two rows cannot share it.
            row('E4', 'fourth@example.org'),
            // A refused row does not claim its values.
            row('E5', 'bad', 'kept@example.org'),
            row('E6', 'kept@example.org'),
          ],
          delimiter: ';',
        },
        mapping,
        unique,
        resolvers,
        translator,
        'employeeNumber'
      );
      const again = prepareRows(
        {
          headers,
          rows: [row('E1', 'a@example.org'), row('E1', 'b@example.org')],
          delimiter: ';',
        },
        mapping,
        unique,
        resolvers,
        translator,
        'employeeNumber'
      );
      expect(rows.map(prepared => prepared.errors)).to.deep.equal([
        [],
        ['Email: “JANE@example.org” is already on line 2'],
        ['Email aliases: “jane@example.org” is already on line 2'],
        [],
        ['Email: Expected an email address'],
        [],
      ]);
      expect(again[1].errors).to.deep.equal([
        'Employee ID: “E1” is already on line 2',
      ]);
    });

    it('should leave out an empty cell rather than send it', () => {
      const [row] = prepare([
        [
          'E3',
          'Doe',
          'Jane',
          'Jane Doe',
          ' ',
          'jane@example.org',
          '',
          'Republic / Gov',
          '',
          '',
        ],
      ]);
      expect(row.errors).to.deep.equal([]);
      expect(row.values).to.not.have.property('personalTitle');
      expect(row.values).to.not.have.property('mailAlternateAddress');
    });
  });
});
