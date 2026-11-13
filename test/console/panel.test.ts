/**
 * The side panel service, mounted into the overlay the frame draws: what it
 * opens on, where the focus goes, and the keys it keeps inside (#221).
 */
import { expect } from 'chai';
import { PanelService, overlayMarkup } from '../../src/console/panel';
import { render } from '../../src/shared/html';

describe('Directory console: the side panel', () => {
  /** The frame's overlay, and the service that shows and hides it. */
  const setup = (): {
    container: HTMLElement;
    service: PanelService;
    panel: HTMLElement;
    dialog: HTMLElement;
    heading: HTMLElement;
    body: HTMLElement;
  } => {
    const container = document.createElement('div');
    document.body.append(container);
    render(container, overlayMarkup('Close'));
    const service = new PanelService(
      () => container,
      key => key
    );
    const { panel, dialog, heading, body } = service.parts();
    if (!panel || !dialog || !heading || !body) throw new Error('no panel');
    return { container, service, panel, dialog, heading, body };
  };

  const parts = (
    container: HTMLElement
  ): {
    first: HTMLInputElement;
    last: HTMLButtonElement;
    close: HTMLButtonElement;
  } => {
    const first = container.querySelector<HTMLInputElement>('#first');
    const last = container.querySelector<HTMLButtonElement>('#last');
    const close =
      container.querySelector<HTMLButtonElement>('[data-panel-close]');
    if (!first || !last || !close) throw new Error('no controls');
    return { first, last, close };
  };

  const press = (
    key: string,
    shiftKey = false,
    used = false
  ): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    if (used) event.preventDefault();
    return event;
  };

  it('should open every form at its top, emptying the one before', () => {
    const { container, service, panel, heading, body } = setup();
    service.open('Edit — bob', body => {
      body.innerHTML = '<p>old</p>';
    });
    body.scrollTop = 739;
    service.close();
    service.open('New group', body => {
      body.innerHTML = '<input id="first" /><button id="last">Save</button>';
    });
    expect(panel.hidden).to.be.false;
    expect(heading.textContent).to.equal('New group');
    expect(body.textContent).to.not.include('old');
    expect(body.scrollTop).to.equal(0);
    expect(container.querySelector('#first')).to.equal(document.activeElement);
  });

  it('should close the panel when the page changes under it', () => {
    const { service, panel } = setup();
    service.open('Edit — alice', body => {
      body.innerHTML = '<input id="first" /><button id="last">Save</button>';
    });
    expect(panel.hidden).to.be.false;
    service.closeOnNavigation();
    expect(panel.hidden).to.be.true;
  });

  it('should be announced as a dialog named by its title', () => {
    const { container } = setup();
    const dialog = container.querySelector('[data-panel-dialog]');
    expect(dialog?.getAttribute('role')).to.equal('dialog');
    expect(dialog?.getAttribute('aria-modal')).to.equal('true');
    expect(dialog?.getAttribute('aria-labelledby')).to.equal('dc-panel-title');
    expect(container.querySelector('#dc-panel-title')).to.not.equal(null);
  });

  it('should take the focus to its first field, and give it back on close', () => {
    const { container, service } = setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    service.open('Edit — alice', body => {
      body.innerHTML = '<input id="first" /><button id="last">Save</button>';
    });
    const { first } = parts(container);
    expect(document.activeElement).to.equal(first);
    service.close();
    expect(document.activeElement).to.equal(opener);
  });

  it('should keep Tab and Shift+Tab inside it', () => {
    const { container, service } = setup();
    service.open('Edit — alice', body => {
      body.innerHTML = '<input id="first" /><button id="last">Save</button>';
    });
    const { first, last, close } = parts(container);

    last.focus();
    const forward = press('Tab');
    service.key(forward);
    expect(forward.defaultPrevented).to.be.true;
    expect(document.activeElement).to.equal(close);

    const backward = press('Tab', true);
    service.key(backward);
    expect(backward.defaultPrevented).to.be.true;
    expect(document.activeElement).to.equal(last);

    // Between two of its controls, Tab is the browser's to move.
    first.focus();
    const within = press('Tab');
    service.key(within);
    expect(within.defaultPrevented).to.be.false;

    // From outside it, back in.
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    service.key(press('Tab'));
    expect(document.activeElement).to.equal(close);
  });

  it('should close on Escape, but not on one a control in it used', () => {
    const { service, panel } = setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    service.open('Edit — alice', body => {
      body.innerHTML = '<input id="first" /><button id="last">Save</button>';
    });
    // A picker closing its list of suggestions prevents the default.
    service.key(press('Escape', false, true));
    expect(panel.hidden).to.be.false;
    service.key(press('Escape'));
    expect(panel.hidden).to.be.true;
    expect(document.activeElement).to.equal(opener);
  });

  it('should leave the keys alone while it is closed', () => {
    const { service } = setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const tab = press('Tab');
    service.key(tab);
    service.key(press('Escape'));
    expect(tab.defaultPrevented).to.be.false;
    expect(document.activeElement).to.equal(opener);
  });

  describe("the discard question and the console's language (#377)", () => {
    /** A panel whose words follow `lang`, which a test changes under it. */
    const worded = (): {
      lang: { value: string };
      service: PanelService;
      body: HTMLElement;
    } => {
      const container = document.createElement('div');
      document.body.append(container);
      render(container, overlayMarkup('Close'));
      const lang = { value: 'en' };
      const service = new PanelService(
        () => container,
        key => `${key}@${lang.value}`
      );
      const body = service.parts().body;
      if (!body) throw new Error('no panel');
      return { lang, service, body };
    };
    const form = (body: HTMLElement): void => {
      body.innerHTML =
        '<div class="dc-form-actions"><button>Cancel</button></div>';
    };
    const asked = (body: HTMLElement): string =>
      (body.querySelector('[data-discard]')?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();

    it('should ask in the language the form was opened in', () => {
      const { lang, service, body } = worded();
      service.open('Edit', b => {
        form(b);
        service.guardDiscard(b, () => true);
      });
      lang.value = 'fr';
      service.close();
      expect(asked(body)).to.equal(
        'form.discardQuestion@en form.keepEditing@en form.discard@en'
      );
    });

    it('should ask in the new language for a form opened after the change', () => {
      const { lang, service, body } = worded();
      service.open('Edit', b => {
        form(b);
        service.guardDiscard(b, () => true);
      });
      service.close(true);
      lang.value = 'fr';
      service.open('Edit', b => {
        form(b);
        service.guardDiscard(b, () => true);
      });
      service.close();
      expect(asked(body)).to.equal(
        'form.discardQuestion@fr form.keepEditing@fr form.discard@fr'
      );
    });
  });
});
