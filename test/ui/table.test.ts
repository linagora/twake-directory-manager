import { expect } from 'chai';
import { html } from '../../src/shared/html';
import { dataTable } from '../../src/ui/table';

describe('ui/table', () => {
  it('should head every column for its rows, and name the table for a reader moving by table', () => {
    const table = dataTable({
      name: 'People',
      columns: [{ heading: 'Name' }, { heading: html`<b>Mail</b>` }],
      rows: [html`<tr><td>alice</td><td>a@example.com</td></tr>`],
    }).markup;
    expect(table)
      .to.include('<div class="dc-table-scroll"><table class="dc-table">')
      .and.include('<caption class="dc-visually-hidden">People</caption>')
      .and.include('<th scope="col">Name</th>')
      .and.include('<th scope="col"><b>Mail</b></th>')
      .and.include(
        '<tbody><tr><td>alice</td><td>a@example.com</td></tr></tbody>'
      );
  });

  it('should take its name from a heading above it, and hide a heading only a screen reader needs', () => {
    const table = dataTable({
      className: 'dc-attached-table',
      wrapperClassName: 'dc-wide',
      name: { labelledBy: 'dc-attached-people-1' },
      columns: [
        { heading: 'Name' },
        { heading: 'Actions', hidden: true },
        {
          heading: html`<input type="checkbox" />`,
          className: 'dc-checkbox-cell',
        },
      ],
      rows: [],
    }).markup;
    expect(table)
      .to.include(
        '<div class="dc-table-scroll dc-wide"><table class="dc-table dc-attached-table" aria-labelledby="dc-attached-people-1">'
      )
      .and.include(
        '<th scope="col"><span class="dc-visually-hidden">Actions</span></th>'
      )
      .and.include(
        '<th scope="col" class="dc-checkbox-cell"><input type="checkbox" /></th>'
      )
      .and.include('<tbody></tbody>');
    expect(table).to.not.include('<caption');
  });

  it('should escape what it is given as text', () => {
    const table = dataTable({
      name: '<b>x</b>',
      columns: [{ heading: 'a<b', className: 'c"d' }],
      rows: [],
    }).markup;
    expect(table)
      .to.include('<caption class="dc-visually-hidden">&lt;b&gt;x&lt;')
      .and.include('<th scope="col" class="c&quot;d">a&lt;b</th>');
    expect(table).to.not.include('<b>x');
  });
});
