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
- A click on an organization’s name shows its card on the right. Hovering the
  name shows its full path.
- The :guilabel:`Filter` box hides the organizations whose name does not
  contain the text typed. It works on the branches already opened: open the
  branch to look in first.
- The transit organization, when the deployment has one, is tagged
  :guilabel:`Transit` (see :doc:`transit`).

A global administrator sees the tree from its root; a local administrator sees
it from their own organization (from one of them, when they administer
several separate ones).

The card of an organization
---------------------------

It shows the organization’s fields and, under :guilabel:`Attached entries`,
the accounts and groups attached to it; a click on one opens its card.

.. note::

   The list of attached entries is capped (at 50 by default) and the card does
   not say so: for a larger organization it is incomplete. A given account is
   then found by searching the :guilabel:`Users` list.

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

Creating an organization
------------------------

To create a sub-organization:

#. In the tree, hover the parent organization and click its :guilabel:`+`
   button (:guilabel:`New organization here`).
#. Fill in the form; fields marked with ``*`` are required.
#. Click :guilabel:`Create`.

The new organization appears in the tree under its parent.

The :guilabel:`New organization` button of the overview creates an
organization at the first level of the tree: it is meant for global
administrators.

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

Select the organization, click :guilabel:`Delete` and confirm.

The server refuses to delete an organization that is not empty: first delete
or move its sub-organizations, and attach its accounts and groups elsewhere
(or delete them).

.. warning::

   Deletion is permanent.
