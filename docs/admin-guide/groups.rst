Managing groups
===============

The :guilabel:`Groups` entry of the sidebar opens the list of the groups in
one’s scope: the groups attached to the organizations one administers. A
group serves as a mailing list, a shared mailbox or a permission group.

Creating a group
----------------

#. In the groups list, click :guilabel:`New group`.
#. Fill in the form (see :ref:`filling-in-a-form`).
#. Click :guilabel:`Create`.

The fields of a group
~~~~~~~~~~~~~~~~~~~~~

With the default Twake schemas:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Field
     - Notes
   * - :guilabel:`Name` \*
     - Written like the part of an email address before the ``@``: letters,
       digits and ``! # $ % & ' * + / = ? ^ _ ` { | } . -``, without two dots
       in a row. **It cannot be changed once the group is created.**
   * - :guilabel:`Description`
     - Free text.
   * - :guilabel:`Email`
     - The group’s address, for a mailing list. The same rules as for an
       account apply: unique, and in an allowed domain (see
       :ref:`email-address`).
   * - :guilabel:`List type`
     - Who may write to the list: :guilabel:`Open to all`,
       :guilabel:`Members only` or :guilabel:`Owners only`.
   * - :guilabel:`Group type`
     - :guilabel:`Group`, :guilabel:`Distribution list` or
       :guilabel:`Shared mailbox`.
   * - :guilabel:`Members`
     - The accounts belonging to the group, by their directory name (DN).
   * - :guilabel:`Owners`
     - The accounts in charge of the group, by their DN.
   * - :guilabel:`Department` \*
     - The organization the group is attached to; it decides who administers
       the group.

:guilabel:`List type` and :guilabel:`Group type` are found under the
*Mailbox Settings* heading of the form.

Managing members
----------------

The members of a group are listed on its card, under :guilabel:`Members`; a
click on a member opens their card. Conversely, the card of an account lists,
under :guilabel:`Mailing lists`, the groups it belongs to.

Members are designated by their **directory name** (DN), such as
``uid=jdoe,ou=users,dc=example,dc=org``: an account’s identifier preceded by
``uid=`` and followed by the users branch of the directory. The operations
team can confirm the exact form in use.

To add or remove members:

#. Open the group’s card and click :guilabel:`Edit`.
#. In the :guilabel:`Members` field:

   - to **add** a member, type their DN and press :kbd:`Enter`;
   - to **remove** one, click the :guilabel:`×` after it.

#. Click :guilabel:`Save`.

:guilabel:`Owners` is filled the same way.

.. note::

   With the default Twake schemas, :guilabel:`Owners` accepts only DNs placed
   directly under the directory’s base (``uid=jdoe,dc=example,dc=org``), which
   accounts stored under ``ou=users`` are not: the form then refuses the value
   with :guilabel:`Expected the DN of an entry of this directory`.

A deleted account is removed from the groups it belonged to.

Deleting a group
----------------

On the group’s card, click :guilabel:`Delete`, then confirm. The member
accounts are not affected.
