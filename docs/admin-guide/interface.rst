A tour of the interface
=======================

The screen is made of four permanent areas.

.. code-block:: text

   ┌────────────────┬─────────────────────────────────────────────┐
   │ Sidebar        │ Banner: scope                    [Sign out] │
   │                ├─────────────────────────────────────────────┤
   │ Overview       │                                             │
   │ Users          │                                             │
   │ Groups         │              Work area                      │
   │ Organizations  │   (overview, list, entry, tree…)            │
   │ Reference data▾│                                             │
   │                │                                             │
   │ Language [en]  │                                             │
   └────────────────┴─────────────────────────────────────────────┘

The sidebar
-----------

It leads to everything the console can manage:

- :guilabel:`Overview`, the home page;
- the everyday collections: :guilabel:`Users`, :guilabel:`Groups`,
  :guilabel:`Organizations`;
- the :guilabel:`Reference data` section, closed by default, which gathers the
  lists of values (positions, titles, account states, mail domains…). A click
  on its heading opens it, and the console remembers the choice. It also
  opens by itself when one of its pages is shown;
- at the bottom, the :guilabel:`Language` selector (``en`` or ``fr``). The
  whole interface changes language, field labels included; the choice is
  remembered by the browser.

The entry of the page being shown is highlighted.

The banner
----------

At the top of the screen, the banner always shows **what one administers**:
each organization of the scope, followed by the rights held on it (``read``,
``write``, ``delete``). Hovering an organization shows its full path. When
the deployment uses a transit organization, it is shown there too, as a link
(see :doc:`transit`).

The :guilabel:`Sign out` button sits at the right of the banner (see
:doc:`signing-in`).

The overview
------------

This is the home page. It recalls the account one is signed in with
(:guilabel:`Signed in as …`) and shows, under
:guilabel:`What you can manage`, a card for each collection:

- :guilabel:`Open` shows the list;
- :guilabel:`New user` (or group, organization) opens the creation form
  directly;
- :guilabel:`Creation not allowed here` replaces that button when the scope
  does not allow creating that kind of entry.

The reference data is listed below, as links.

Forms: side panel or dialog
---------------------------

Creations and edits open over the work area:

- a long form (an account, for instance) opens in a **side panel**, on the
  right, whose buttons stay within reach;
- a short form (claiming an entry in transit, for instance) opens in a
  **dialog** in the middle of the screen.

A creation form ends with :guilabel:`Create`, an edit form with
:guilabel:`Save`. The :guilabel:`×` or the :guilabel:`Cancel` button close
the form without saving anything.

.. _filling-in-a-form:

Filling in a form
~~~~~~~~~~~~~~~~~

Every form works the same way:

- fields marked with ``*`` are required;
- fields are grouped by topic, under a heading;
- a hint under a field gives the expected format. When saving, the values are
  checked before anything is sent to the server: an empty required field or a
  value in the wrong format is flagged in red under the field;
- a field taking **several values** (aliases, phone numbers…) is filled one
  value at a time: type the value, then press :kbd:`Enter`. Each value becomes
  a token, which its :guilabel:`×` removes;
- a field pointing into **reference data** (title, position, department…) is
  a drop-down list (:guilabel:`Choose…`);
- a field pointing at **accounts** (delegates, managers, local
  administrators) is a search box: type at least three
  characters of the name or identifier, then pick from the list with the
  mouse, or with the arrow keys and :kbd:`Enter`;
- a yes/no field offers :guilabel:`Yes`, :guilabel:`No` or ``—`` (not set); a
  date field opens a date picker.

Fields the server computes (identifier, path, status…) are not in the form.
The identifier of an entry cannot be changed once it is created.

When the server refuses to save (an address already in use, for instance),
the form stays open and a message gives the reason: correct it and save again.

Messages
--------

The outcome of each action shows in a short message at the bottom of the
screen (:guilabel:`Saved`, :guilabel:`Created`, :guilabel:`Deleted`…). A
refusal from the server shows the same way, in red, with the reason the
server gave.

Deletions and hand-overs ask for a confirmation in a browser dialog
(:guilabel:`OK` / :guilabel:`Cancel`).

Appearance
----------

The console follows the system’s light or dark setting. On a narrow screen (a
phone, a tablet held upright), the sidebar becomes a row of entries that
scrolls sideways.
