Global and local administrators
===============================

Where rights come from
----------------------

Administration rights are held by the organizations themselves: every
organization has a :guilabel:`Local administrators` field listing the accounts
allowed to manage it. An account appointed on an organization gets **read**,
**write** and **delete** rights on it, which extend:

- to all its sub-organizations, at every level;
- to every account and every group attached to them.

A **global administrator** is simply an account appointed on the root
organization of the tree: their rights then cover the whole directory.

.. code-block:: text

   Company                  ← global administrators
   ├── Head office
   ├── Human resources      ← local administrator: Ms Smith
   │   ├── Payroll          ← managed by Ms Smith too
   │   └── Recruitment      ← managed by Ms Smith too
   └── Production           ← outside Ms Smith’s scope

What a local administrator sees
-------------------------------

- **The organization tree** starts at their own organization, not at the root
  of the company. An administrator of several separate organizations sees the
  tree — and the :guilabel:`Department` lists of the forms — of only one of
  them; the others stay in the banner, and their entries in the lists.
- **The lists of accounts and groups** hold only the entries attached to
  their organizations. An entry attached elsewhere does not appear, and
  opening it through a direct link shows
  :guilabel:`This entry no longer exists`.
- **Reference data** can be read by every administrator (see
  :doc:`reference-data` for who changes it).
- They can **create** accounts and groups attached to their organizations,
  and sub-organizations under them. The :guilabel:`Department` field of a
  form offers only what is in their scope.
- An organization is judged on its **parent**: a local administrator edits
  and deletes the sub-organizations of their organization, but not the
  organization they are appointed on — that belongs to the administrators
  above it. Likewise, the root organization cannot be edited from the
  console at all.
- To hand an entry over to an organization they do not manage, they go
  through the transit organization (see :doc:`transit`).

The console does not offer what the scope forbids: no creation button without
the write right, no :guilabel:`Delete` button without the delete right. The
server checks every operation anyway: should an action be offered on an entry
outside the scope — the card of one’s own organization, reference data —
the server refuses it and the console shows the reason.

Reading the scope banner
------------------------

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - The banner shows
     - What it means
   * - :guilabel:`You administer` followed by one or more organizations
     - The usual case. Each organization is followed by the rights held on
       it; hovering its name shows its full path.
   * - :guilabel:`You administer no branch`
     - The account is appointed on no organization. It can sign in but can
       do nothing: ask a global administrator.
   * - :guilabel:`Unrestricted access`
     - The server applies no per-organization restriction (a test instance,
       for instance). Every action is offered.
   * - :guilabel:`Your permissions are not described by the server — it checks each action`
     - Every action is offered, and the server accepts or refuses each one
       when it is performed.
   * - :guilabel:`Your permissions could not be read (…) — read-only until they can`
     - An error prevented reading the scope. As a precaution, the console
       offers no write action at all. Reload the page; if the message
       persists, contact the operations team.

Appointing a local administrator
--------------------------------

*This takes the right to change the organization, which is judged on its
parent: a global administrator, or the local administrator of a parent
organization.*

#. Open :guilabel:`Organizations` and select the organization in the tree.
#. Click :guilabel:`Edit`.
#. In the :guilabel:`Local administrators` field, type at least three
   characters of the account’s name or identifier, then pick the account from
   the list (with the mouse, or with the arrow keys and :kbd:`Enter`). Repeat
   to add more.
#. Click :guilabel:`Save`.

To remove an administrator, click the :guilabel:`×` next to their name in the
same field, then save.

.. important::

   The server caches rights for **five minutes**, and the console reads them
   when the page loads. A newly appointed — or removed — administrator may
   have to wait up to five minutes, then reload the page, before their
   rights change.

.. note::

   Global administrators are appointed on the root organization, which cannot
   be edited from the console: the operations team appoints them directly in
   the directory. Such an appointment gives the right to delete any entry of
   the directory.
