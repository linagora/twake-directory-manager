Managing organizations
======================

The :guilabel:`Organizations` entry of the sidebar opens the organization
tree, on the left, and the card of the selected organization, on the right.
The tree stays on screen while an organization is read or edited.

Browsing the tree
-----------------

- The ``▸`` arrow in front of an organization opens its sub-organizations;
  ``▾`` closes them. Once opened, an organization without sub-organizations
  shows a dot ``·`` instead.
- A click on an organization’s name shows its card on the right and opens
  its sub-organizations; only the arrow closes them again. Hovering the name
  shows its full path.
- The :guilabel:`Filter` box searches the whole tree from two characters on,
  closed branches included, and lists the organizations whose path contains
  the text typed (``Sales / France``). A click on one opens the tree down to
  it and shows its card. An ldap-rest that searches the tree keeps only the
  first matches of a broad text (50 by default, its
  ``ldap_organization_max_subnodes`` setting), and the list then ends with
  *First 50 matches — type more to narrow*: those kept are the first the
  directory found, not the first in alphabetical order, so one missing from
  the list may still exist. Such a server also matches the organizations’
  descriptions, so a match may not show the text typed in its path. A single
  character only hides, in the branches already opened, the organizations
  whose name does not contain it. When the whole tree cannot be searched (an
  ldap-rest without organization search whose tree is too wide to read
  whole, or a failure), the filter also searches the branches already opened
  and says it found nothing *among the opened branches*: another branch may
  still hold a match.
- The transit organization, when the deployment has one, is tagged
  :guilabel:`Transit` (see :doc:`transit`).

A global administrator sees the tree from its root; a local administrator sees
it from their own organization (from one of them, when they administer
several separate ones).

The card of an organization
---------------------------

It shows the organization’s fields, then the entries attached to it in two
tables:

- :guilabel:`People (N)`: the accounts, by full name, email, position and
  status;
- :guilabel:`Groups (N)`: the groups, by name, email and group type.

A click on a row, or :kbd:`Enter` on its name, opens the entry’s card.

:guilabel:`New user here` and :guilabel:`New group here`, in the tables’
headings, open the creation form with the department already set to this
organization; the new entry then joins the table. They are offered where
the administrator may create such an entry and writes the organization, and
not on the transit organization.

.. note::

   Each table lists at most 50 entries by default (the server’s
   ``ldap_organization_max_subnodes``). Past that, its heading reads
   :guilabel:`People (50+)` and a line under it says how many it leaves out;
   a given account is then found by searching the :guilabel:`Users` list.

   A local administrator is listed only the entries of the organizations
   they administer: on another organization’s card, an empty table reads
   :guilabel:`None you manage is attached to …`.

The fields of an organization (default Twake schemas):

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Field
     - Purpose
   * - :guilabel:`Name` \*
     - The organization’s name, as shown in the tree and in paths. Letters,
       digits, spaces and ``( ) & / , . ' - _``, starting with a letter or a
       digit. **It cannot be changed once the organization is created.**
   * - :guilabel:`Description`, :guilabel:`Phone`, :guilabel:`Fax`,
       :guilabel:`Locality`, :guilabel:`Address`
     - Contact details. :guilabel:`Phone` takes several numbers.
   * - :guilabel:`Path`
     - Computed from the organization’s place in the tree.
   * - :guilabel:`Managers`
     - The accounts heading the organization.
   * - :guilabel:`Mail domains`
     - The domains allowed in the email addresses of the accounts and groups
       attached to this organization and to its sub-organizations (see
       :ref:`email-address`).
   * - :guilabel:`Local administrators`
     - The accounts administering this organization and everything under it
       (see :doc:`scope`).

:guilabel:`Managers` and :guilabel:`Local administrators` point at accounts:
they are search boxes. Type at least three characters of the name or
identifier, then pick from the list.

:guilabel:`Mail domains` lists the domains as you type part of their name;
press :kbd:`↓` in the empty box to see them all. Unless you administer the
top organization, it offers only the domains already linked by an
organization above the one you edit or create: the server refuses any
other.

Creating an organization
------------------------

To create a sub-organization:

#. Select the parent organization and click :guilabel:`New organization
   here` on its card, or the :guilabel:`+` button at the end of its row in
   the tree, shown on the selected organization and on the one the pointer
   is over. Both show only on the organizations one administers and those
   under them.
#. Fill in the form; fields marked with ``*`` are required.
#. Click :guilabel:`Create`.

The new organization appears in the tree under its parent.

The :guilabel:`New organization` button of the overview creates an
organization at the first level of the tree when one administers the root.
Otherwise it creates it under the organization one administers; an
administrator of several picks it in :guilabel:`Parent organization`, above
the form.

Editing an organization
-----------------------

An organization is edited and deleted by the administrators of its
**parent**: a local administrator works on the sub-organizations of their
organization, not on the one they are appointed on, and the root organization
cannot be edited from the console. The :guilabel:`Edit` and
:guilabel:`Delete` buttons may show on those cards anyway; the server then
refuses the change.

Select the organization, click :guilabel:`Edit`, change the fields, then
:guilabel:`Save`. To empty a field, clear its value; to remove one value from
a multi-valued field, click the :guilabel:`×` after it.

Deleting an organization
------------------------

Select the organization, open :guilabel:`More`, click :guilabel:`Delete`,
then :guilabel:`Delete organization`.

The server refuses to delete an organization that is not empty: first delete
or move its sub-organizations, and attach its accounts and groups elsewhere
(or delete them).

.. warning::

   Deletion is permanent.
