/**
 * The toast: what everyone sees for a moment, said as it shows (#221).
 */
import { expect } from 'chai';
import { overlayMarkup } from '../../src/console/panel';
import { ToastController } from '../../src/ui/toast';

describe('ui/toast', () => {
  /** The toast the frame drew, inside its live region. */
  const setup = (): {
    toast: HTMLElement;
    region: HTMLElement;
    toasts: ToastController;
  } => {
    const region = document.createElement('div');
    region.setAttribute('data-toast-region', '');
    const toast = document.createElement('div');
    toast.hidden = true;
    region.append(toast);
    document.body.append(region);
    return {
      toast,
      region,
      toasts: new ToastController(() => toast, 20),
    };
  };

  const wait = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

  it('should hide an ordinary message after a while', async () => {
    const { toast, toasts } = setup();
    toasts.show('Saved');
    expect(toast.hidden).to.be.false;
    await wait(40);
    expect(toast.hidden).to.be.true;
  });

  it('should be said by a screen reader, a refusal at once', () => {
    const { toast, region, toasts } = setup();
    toasts.show('Refused', true);
    expect(region.getAttribute('aria-live')).to.equal('assertive');
    expect(toast.textContent).to.equal('Refused');
    toasts.show('Saved');
    expect(region.getAttribute('aria-live')).to.equal('polite');
    expect(toast.textContent).to.equal('Saved');
  });

  it('should give a new message its whole delay', async () => {
    const { toast, toasts } = setup();
    toasts.show('First');
    await wait(12);
    toasts.show('Second');
    await wait(12);
    expect(toast.hidden, 'hidden by the first timer').to.be.false;
    await wait(20);
    expect(toast.hidden).to.be.true;
  });

  it('should be drawn with the frame, in its live region', () => {
    expect(overlayMarkup('Close').markup).to.contain(
      '<div data-toast-region role="status" aria-live="polite" aria-atomic="true">'
    );
    expect(overlayMarkup('Close').markup).to.contain(
      '<div class="dc-toast" data-toast hidden></div>'
    );
  });
});
