Handing an entry over: transit
==============================

An administrator can move an account or a group only between organizations
they manage. To hand one over to an organization managed by someone else —
an employee changing departments, for instance — the entry goes through a
**transit organization**, in two steps:

#. the current administrator **hands it over**: the entry goes into transit,
   and they no longer manage it;
#. the new administrator **claims** it into one of their own organizations.

.. note::

   This chapter applies only when the deployment has a transit organization.
   It then shows in the scope banner, under :guilabel:`Transit`, and is tagged
   :guilabel:`Transit` in the organization tree. Without one, the buttons
   described here do not appear: ask a global administrator to move the
   entry, by changing its :guilabel:`Department` field.

Handing an entry over
---------------------

#. Open the card of the account or the group.
#. Click :guilabel:`Hand over`.
#. Confirm. The confirmation reminds that every administrator will see the
   entry and may claim it, and that one will no longer manage it.

The entry is now in transit. Tell the administrator who is to take it over.

Finding the entries in transit
------------------------------

Every administrator can see the entries in transit:

- a click on the transit organization’s name, in the scope banner, opens its
  card, which lists the entries waiting in it under
  :guilabel:`Attached entries`;
- the card of an entry in transit is tagged :guilabel:`In transit`.

The banner is the way in for a local administrator, whose organization tree
starts at their own organization and seldom shows the transit organization.

Claiming an entry
-----------------

#. Open the card of the entry in transit.
#. Click :guilabel:`Claim…`.
#. Under :guilabel:`Into the organization`, choose the destination among
   one’s own organizations.
#. Click :guilabel:`Confirm`.

The entry now belongs to the chosen organization, and is managed by its
administrators.

When one writes in no organization that could take the entry, the dialog says
so (:guilabel:`You write in no organization that could take it`).

.. important::

   While an entry is in transit, the other actions (edit, status, password,
   deletion) are offered only to the administrators of the transit
   organization itself — or of an organization above it, global
   administrators included. Everyone else claims the entry first, then works
   on it.

Entries attached to no organization
-----------------------------------

An account attached to no organization — one created by another tool, for
instance — counts as in transit too: it can be claimed the same way. It is
found through a search in the :guilabel:`Users` list. It cannot be edited
until it is claimed. A **group** attached to no organization cannot be
claimed: ask the operations team.
