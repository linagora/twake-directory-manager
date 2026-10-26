import { expect } from 'chai';
import { searchBox } from '../../src/ui/search';

describe('ui/search', () => {
  it('should draw a named box alone', () => {
    const markup = searchBox({
      data: 'filter',
      name: 'Filter organizations',
      placeholder: 'Filter',
      value: 'Sal',
    }).markup;
    expect(markup)
      .to.include('<input type="search" class="dc-input" data-filter')
      .and.include('value="Sal"')
      .and.include('placeholder="Filter"')
      .and.include(
        'aria-label="Filter organizations" title="Filter organizations"'
      );
    expect(markup).to.not.include('dc-search-scope');
  });

  it('should add the select of a scope, named too, with its choice selected', () => {
    const markup = searchBox({
      data: 'search',
      name: 'Search Users',
      placeholder: 'Search',
      value: '',
      scope: {
        data: 'search-attribute',
        text: 'in',
        name: 'Search in',
        options: [
          { value: '*', label: 'Every field' },
          { value: 'mail', label: 'Email', selected: true },
        ],
      },
    }).markup;
    expect(markup)
      .to.include('<div class="dc-search">')
      .and.include('data-search\n')
      .and.include('<span>in</span>')
      .and.include('data-search-attribute aria-label="Search in"')
      .and.include('<option value="*">Every field</option>')
      .and.include('<option value="mail" selected>Email</option>');
  });

  it('should escape what it is given', () => {
    const markup = searchBox({
      data: 'search',
      name: 'a"b',
      placeholder: '<b>',
      value: 'x" onfocus="y',
    }).markup;
    expect(markup)
      .to.include('aria-label="a&quot;b"')
      .and.include('placeholder="&lt;b&gt;"')
      .and.include('value="x&quot; onfocus=&quot;y"');
  });
});
