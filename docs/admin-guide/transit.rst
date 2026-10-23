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
#. Open :guilabel:`More`, then click :guilabel:`Hand over`.
#. Click :guilabel:`Hand over` in the confirmation. It names the entry and
   the organization it leaves, and reminds that every administrator will see
   the entry and may claim it, and that one will no longer manage it.

The entry is now in transit, and the message says where it came from:
:guilabel:`bob (Sales / Germany) is in transit`. The entry itself no longer
names that organization: tell the administrator who is to take it over.

Finding the entries in transit
------------------------------

Every administrator is told what waits in transit, and can see it:

- the overview opens on :guilabel:`Waiting in transit (N)`, which lists each
  entry waiting there (name, email, position or group type), each with a
  :guilabel:`Claim…` button. The section is absent when nothing waits;
- in the scope banner, the transit organization’s link counts the entries
  waiting there, :guilabel:`Transit (2)`, and reads :guilabel:`Transit`
  alone when there are none. A click on it opens the transit organization’s
  card, which lists them in its :guilabel:`People` and :guilabel:`Groups`
  tables, each with :guilabel:`Claim…` too;
- the card of an entry in transit is tagged :guilabel:`In transit`.

The overview and the banner are the way in for a local administrator, whose
organization tree starts at their own organization and seldom shows the
transit organization.

Every administrator writes in the transit organization, to hand entries over,
but that makes it no organization of theirs: its card offers a local
administrator neither :guilabel:`Edit` nor :guilabel:`Delete`. Only an
administrator of an organization above it, a global administrator for
instance, keeps them.

Claiming an entry
-----------------

#. Click :guilabel:`Claim…` on the entry’s row, in the overview or on the
   transit organization’s card, or open the card of the entry in transit and
   click :guilabel:`Claim…` there.
#. Under :guilabel:`Into the organization`, choose the destination among
   one’s own organizations.
#. Click :guilabel:`Claim into <organization>`, which names the destination
   chosen.

The entry now belongs to the chosen organization, and is managed by its
administrators. It leaves the overview’s list, and the banner’s count, at
once.

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
