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

A click on a row opens the entry’s card.

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

:guilabel:`Delete selection`
   Offered only with the delete right. After a confirmation, the entries are
   deleted one by one; when the server refuses some of them, the final
   message says which and why. The others are deleted.

The card of an entry
--------------------

The card shows:

- at the top, the :guilabel:`Back` button (to the list), the entry’s name and
  the **actions** allowed: :guilabel:`Edit`, a status change,
  :guilabel:`Reset password`, :guilabel:`Delete`, :guilabel:`Hand over`…;
- the :guilabel:`Details` section, with **every** field of the entry, empty
  ones included (shown as ``—``). A value taken from reference data (a
  position, a status) is shown by its name;
- for accounts and groups, the **related entries**: the mailing lists of an
  account, the members of a group (:guilabel:`No related entry` when there
  are none). A click on one opens its card.

The :guilabel:`Department path` of an account or a group is a link: it opens
the department in the organization tree.

Fields filled automatically (identifier, path, status…) are shown on the card
but never offered for editing. Passwords are never shown.
