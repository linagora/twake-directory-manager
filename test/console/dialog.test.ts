import { expect } from 'chai';
import { confirmMarkup, markAlert } from '../../src/console/dialog';

describe('the confirm dialog', () => {
  it('should draw the question, its names, its choices, an alternative and the two buttons', () => {
    const markup = confirmMarkup(
      {
        title: 'Delete 2 accounts?',
        lines: ['They will be gone.', 'For good.'],
        items: ['alice', 'bob'],
        action: 'Delete 2 accounts',
        alternative: { label: 'Disable them instead', run: () => undefined },
        choices: {
          title: 'Along with them',
          options: [
            { label: 'Their mailboxes', checked: true },
            { label: 'Their groups', checked: false },
          ],
        },
      },
      'Cancel'
    ).markup;
    expect(markup)
      .to.include(
        '<div class="dc-confirm" id="dc-confirm-body" data-confirm-body>'
      )
      .and.include('<p>They will be gone.</p><p>For good.</p>')
      .and.include(
        '<ul class="dc-confirm-items"><li>alice</li><li>bob</li></ul>'
      )
      .and.include('<legend>Along with them</legend>')
      .and.include('data-confirm-choice="0" checked')
      .and.include('data-confirm-choice="1" />')
      .and.include('data-confirm-alternative>Disable them instead</button>')
      .and.include('data-cancel>Cancel</button>')
      .and.include(
        'dc-button-destructive" data-confirm>Delete 2 accounts</button>'
      );
  });

  it('should colour a reversible action as the primary one, and leave out what is not asked', () => {
    const markup = confirmMarkup(
      {
        title: 'Move?',
        lines: ['It moves.'],
        action: 'Move',
        reversible: true,
      },
      'Cancel'
    ).markup;
    expect(markup).to.include('dc-button-primary" data-confirm>Move</button>');
    expect(markup).to.not.include('dc-confirm-items');
    expect(markup).to.not.include('dc-confirm-choices');
    expect(markup).to.not.include('dc-confirm-alternative');
  });

  it('should make the panel an alert dialog while it asks, a dialog after', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    markAlert(dialog, true);
    expect(dialog.getAttribute('role')).to.equal('alertdialog');
    expect(dialog.getAttribute('aria-describedby')).to.equal('dc-confirm-body');
    markAlert(dialog, false);
    expect(dialog.getAttribute('role')).to.equal('dialog');
    expect(dialog.hasAttribute('aria-describedby')).to.equal(false);
  });
});
