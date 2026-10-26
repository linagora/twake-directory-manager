import { expect } from 'chai';
import { displayValue, formatByteSize, readableByteSize } from '../src/format';

describe('format', () => {
  describe('formatByteSize', () => {
    it('should say a size the way it was set', () => {
      // `normalize: byteSize` stores what `parseByteSize` computed, so a quota
      // set as `4GB` reads back as ten digits nobody counts at a glance.
      expect(formatByteSize('2000000000')).to.equal('2 GB');
      expect(formatByteSize('1500000')).to.equal('1.5 MB');
      expect(formatByteSize('999')).to.equal('999 B');
      expect(formatByteSize('0')).to.equal('0 B');
    });

    it('should say it only when the short form is the same number', () => {
      // The form hands what it shows back to the server, which reads it with
      // `parseByteSize`: a rounded size would write a different quota than the
      // one displayed. A value no unit states exactly stays as it is.
      expect(formatByteSize('2000000001')).to.equal('2000000001');
      expect(formatByteSize('1099511627776')).to.equal('1099511627776');
      expect(formatByteSize('not a number')).to.equal('not a number');
    });

    it('should round-trip every value it chooses to format', () => {
      // What ldap-rest's `parseByteSize` (plugins/ldap/enterpriseRules) reads
      // each of these as: decimal units, 1 kB = 1000 bytes. The console no
      // longer lives beside it, so the server's answers are written down here;
      // a change on either side that breaks the round trip fails this table.
      const server: Record<string, number> = {
        '2 GB': 2000000000,
        '2.048 KB': 2048,
        '1.5 MB': 1500000,
        '512 GB': 512000000000,
      };
      for (const raw of ['2000000000', '2048', '1500000', '512000000000']) {
        const shown = formatByteSize(raw);
        expect(server, shown).to.have.property(shown);
        expect(String(server[shown]), shown).to.equal(raw);
      }
    });

    it('should round on the card what no unit says exactly', () => {
      // The card hands nothing back to the server: a gibibyte reads 1.07 GB
      // there rather than ten digits, and says so.
      expect(readableByteSize('1073741824')).to.deep.equal({
        text: '1.07 GB',
        exact: false,
      });
      expect(readableByteSize('15728640')).to.deep.equal({
        text: '15.7 MB',
        exact: false,
      });
      expect(readableByteSize('4000000000')).to.deep.equal({
        text: '4 GB',
        exact: true,
      });
      expect(readableByteSize('999')).to.deep.equal({
        text: '999 B',
        exact: true,
      });
      // Rounded up to a thousand, it reads in the unit above.
      expect(readableByteSize('999999999')).to.deep.equal({
        text: '1 GB',
        exact: false,
      });
      expect(readableByteSize('999999999999')).to.deep.equal({
        text: '1 TB',
        exact: false,
      });
      expect(readableByteSize('999499999')).to.deep.equal({
        text: '999 MB',
        exact: false,
      });
      expect(readableByteSize('1999999999999999')).to.deep.equal({
        text: '2,000 TB',
        exact: false,
      });
      expect(readableByteSize('lots')).to.deep.equal({
        text: 'lots',
        exact: true,
      });
    });

    it("should write a size on the card the reader's way", () => {
      // French writes 1,07 Go: a decimal comma, and octets.
      expect(readableByteSize('1073741824', 'fr')).to.deep.equal({
        text: '1,07 Go',
        exact: false,
      });
      expect(readableByteSize('4500000000', 'fr-FR')).to.deep.equal({
        text: '4,5 Go',
        exact: true,
      });
      expect(readableByteSize('999', 'fr')).to.deep.equal({
        text: '999 o',
        exact: true,
      });
      expect(readableByteSize('lots', 'fr')).to.deep.equal({
        text: 'lots',
        exact: true,
      });
      // A language without symbols of its own keeps the English ones.
      expect(readableByteSize('15728640', 'mn').text).to.equal('15.7 MB');
      // So do the lists, which show what a unit says exactly, and the digits
      // of what none does.
      const size = { type: 'number', normalize: 'byteSize' } as const;
      expect(displayValue(size, '4500000000', undefined, 'fr')).to.equal(
        '4,5 Go'
      );
      expect(displayValue(size, '4500000000')).to.equal('4.5 GB');
      expect(displayValue(size, '1073741824', undefined, 'fr')).to.equal(
        '1073741824'
      );
    });
  });
});
