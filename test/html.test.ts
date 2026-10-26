import { expect } from 'chai';

import { SafeHtml, html, join, render, trusted } from '../src/shared/html';

describe('html', () => {
  it('should escape every interpolation, in text and in attributes', () => {
    const name = '<img src=x onerror=alert(1)>';
    const title = 'say "hi" & \'bye\'';
    expect(html`<p title="${title}">${name}</p>`.markup).to.equal(
      '<p title="say &quot;hi&quot; &amp; &#x27;bye&#x27;">&lt;img src=x onerror=alert(1)&gt;</p>'
    );
  });

  it('should pass markup through unescaped, and text through escaped', () => {
    const inner = html`<b>${'<i>'}</b>`;
    expect(html`<p>${inner}${'<i>'}</p>`.markup).to.equal(
      '<p><b>&lt;i&gt;</b>&lt;i&gt;</p>'
    );
    expect(html`<p>${trusted('<svg/>')}</p>`.markup).to.equal('<p><svg/></p>');
  });

  it('should write nothing for what a conditional left out, and each item of an array', () => {
    const rows = ['a', '<b>'];
    const list = html`<ul>${false}${null}${undefined}${rows.map(
      row => html`<li>${row}</li>`
    )}</ul>`;
    expect(list.markup).to.equal('<ul><li>a</li><li>&lt;b&gt;</li></ul>');
    // Nested arrays, as a map over groups of rows gives.
    expect(html`${[[html`<i/>`, 'x'], html`<b/>`]}`.markup).to.equal(
      '<i/>x<b/>'
    );
    // Numbers and true are written as text.
    expect(html`${0}${1.5}${true}`.markup).to.equal('01.5true');
  });

  it('should join pieces with an escaped separator', () => {
    expect(join([html`<i/>`, html`<b/>`], ' <& ').markup).to.equal(
      '<i/> &lt;&amp; <b/>'
    );
    expect(join([], ', ').markup).to.equal('');
  });

  it('should render markup into an element', () => {
    const element = { innerHTML: '' } as unknown as Element;
    render(element, html`<p>${'<x>'}</p>`);
    expect(element.innerHTML).to.equal('<p>&lt;x&gt;</p>');
    expect(html``).to.be.instanceOf(SafeHtml);
  });

  it('should refuse to be read as a string', () => {
    // Joined, concatenated or put in a plain template, markup would read
    // "[object Object]" or be escaped on its way in: it fails where it is.
    const piece = html`<b>x</b>`;
    expect(() => `${piece}`).to.throw(/SafeHtml used as a string/);
    expect(() => [piece].join('')).to.throw(/SafeHtml used as a string/);
    expect(() => String(piece)).to.throw(/SafeHtml used as a string/);
  });
});
