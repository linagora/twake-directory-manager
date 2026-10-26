import { expect } from 'chai';
import {
  ANNOUNCE_DELAY,
  announcer,
  announcerMarkup,
} from '../../src/ui/announce';

const later = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

describe('ui/announce', () => {
  it('should draw a hidden polite region', () => {
    const markup = announcerMarkup().markup;
    expect(markup)
      .to.include('class="dc-visually-hidden"')
      .and.include('data-announce')
      .and.include('role="status"')
      .and.include('aria-live="polite"')
      .and.include('aria-atomic="true"');
  });

  it('should empty the region, then write the text, so that a repeat is spoken again', async () => {
    const region = document.createElement('div');
    region.textContent = 'before';
    const announce = announcer(() => region);
    announce('1 selected');
    expect(region.textContent).to.equal('');
    await later(ANNOUNCE_DELAY + 20);
    expect(region.textContent).to.equal('1 selected');
    announce('1 selected');
    expect(region.textContent).to.equal('');
    await later(ANNOUNCE_DELAY + 20);
    expect(region.textContent).to.equal('1 selected');
  });

  it('should keep the last of two texts said within the delay, and say nothing without a region', async () => {
    const region = document.createElement('div');
    const announce = announcer(() => region);
    announce('1 selected');
    announce('2 selected');
    await later(ANNOUNCE_DELAY + 20);
    expect(region.textContent).to.equal('2 selected');
    expect(() => announcer(() => null)('lost')).to.not.throw();
  });
});
