Lists, search and entries
=========================

Users, groups and reference data are all browsed the same way: a list, which
is searched, then the card of one entry.

Searching
---------

At the top of the list:

- the :guilabel:`Search` box;
- the :guilabel:`in` selector, which narrows the search to one field or runs
  it on :guilabel:`Every field`, the default. One can thus find someone by
  their last name without knowing their identifier.

With the default Twake schemas, the search covers:

- for users: the identifier, employee ID, common name, last name, first name
  and email;
- for groups: the name, description and email.

The list updates as one types.

.. note::

   **Users and groups: three characters at least.** These lists can hold
   thousands of entries; they stay empty until the search holds at least
   three characters (:guilabel:`Type at least 3 characters to search`). The
   :guilabel:`List everything (may be slow)` button shows every entry of the
   scope anyway. Reference data, much shorter, is listed whole straight away.

Reading the list
----------------

The columns are chosen to recognize an entry at a glance: the identifier,
then, depending on the collection, the employee ID, full name, email,
department path, list type and account status.

A deep department path is shortened to its root and its leaf
(``Human resources / … / Payroll``); hovering it shows the whole path.

A click on a row opens the entry’s card. Its first column is a link: with
the keyboard, :kbd:`Tab` reaches it and :kbd:`Enter` opens the card, and a
middle click or :kbd:`Ctrl` + click opens the card in a new tab.

Pages
-----

Below the list:

- :guilabel:`Per page` sets how many rows are shown (25, 50, 100 or 200).
  The choice is remembered;
- the counter (:guilabel:`1–25 of 312`) and the :guilabel:`Previous` and
  :guilabel:`Next` buttons move through the pages.

Selecting several entries
-------------------------

The checkboxes at the start of each row select entries; the one in the header
selects every row of the page. As soon as an entry is selected, an action bar
appears:

:guilabel:`Export selection`
   Downloads a CSV file of the selected entries, with the columns of the
   list. It opens in a spreadsheet. The file holds the raw directory data:
   the headings are the technical attribute names (``uid``,
   ``employeeNumber``, ``mail``…), and a value taken from reference data or a
   department is written as its full directory name (DN), not as the name the
   list shows.

   As a safety measure, a cell a spreadsheet would read as a formula (starting
   with ``=``, ``+``, ``-`` or ``@``) is prefixed with an apostrophe.

:guilabel:`Add to a group…` (accounts list)
   Opens a search among the groups you administer. Choose one or more, then
   click :guilabel:`Add`: each selected account joins each group, one already
   in it being left as it is. A group that refuses stays chosen in the panel,
   with the reason; the others are joined.

:guilabel:`Change state…` (accounts list)
   Offers the states an account can take. Once one is chosen and applied, the
   accounts change state one after the other, the panel counting them; those
   the server refuses are then listed with the reason.

   Both are offered to whoever administers accounts. Selected accounts that
   you do not administer, such as those waiting in transit, are left out, and
   the panel says how many. Once the panel is closed, the list is read again
   and the selection cleared, unless every account or group was refused: the
   selection then stays, to try again.

:guilabel:`Delete selection`
   Offered only with the delete right. The confirmation lists the first five
   entries and how many more; once confirmed, the entries are deleted one by
   one; when the server refuses some of them, the final
   message says which and why. The others are deleted.

The card of an entry
--------------------

The card shows:

- at the top, the :guilabel:`Back` button (to the list), the entry’s name —
  an account’s full name, with its identifier and its address under it — and
  the **actions** allowed: :guilabel:`Edit`, :guilabel:`Reset password`,
  :guilabel:`Change state…`, then :guilabel:`More`, a menu holding
  :guilabel:`Hand over` and :guilabel:`Delete`;
- the :guilabel:`Details` section, with **every** field of the entry, grouped
  under the headings of the form, or :guilabel:`Identity`,
  :guilabel:`Organization`, :guilabel:`Contact`, :guilabel:`Mailbox` and
  :guilabel:`Lifecycle`. The empty fields are folded under
  :guilabel:`Show empty fields (N)` (shown as ``—`` there), and the entry’s
  directory name (DN), with a :guilabel:`Copy` button, under
  :guilabel:`Technical details`. A value taken from reference data (a
  position, a status) is shown by its name; a mailbox size is shown in GB or
  MB, rounded when needed, the exact number of bytes in its tooltip;
- for accounts and groups, the **related entries**: the groups of an
  account, the members of a group (:guilabel:`No related entry` when there
  are none). A click on one opens its card.

The :guilabel:`Department path` of an account or a group is a link: it opens
the department in the organization tree.

Fields filled automatically (identifier, path, status…) are shown on the card
but never offered for editing. Passwords are never shown.
