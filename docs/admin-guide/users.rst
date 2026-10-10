Managing user accounts
======================

The :guilabel:`Users` entry of the sidebar opens the list of the accounts in
one’s scope (see :doc:`lists` for searching and selecting).

Creating an account
-------------------

#. In the users list, click :guilabel:`New user` (the same button is on the
   overview).
#. Fill in the form, which opens in the side panel (see
   :ref:`filling-in-a-form`).
#. Click :guilabel:`Create`.

The console then shows the new account’s card.

To create many accounts at once, see :doc:`import`.

The fields of an account
~~~~~~~~~~~~~~~~~~~~~~~~

With the default Twake schemas:

.. list-table::
   :header-rows: 1
   :widths: 32 68

   * - Field
     - Notes
   * - :guilabel:`Employee ID` \*
     - The employee’s number. Unique in the directory, except for the
       value ``UNIT``, kept for non-personal accounts.
   * - :guilabel:`Last name` \*, :guilabel:`First name` \*,
       :guilabel:`Full name` \*
     - The full name is the one applications show (lists, mail…).
   * - :guilabel:`Common name`
     - Technical name of the entry; optional.
   * - :guilabel:`Title`, :guilabel:`Position`
     - Picked from the matching reference data.
   * - :guilabel:`Comment`
     - Free text.
   * - :guilabel:`Email` \*
     - The main address. See :ref:`email-address`.
   * - :guilabel:`Email aliases`
     - Further addresses delivered to the same mailbox.
   * - :guilabel:`Phone`, :guilabel:`Mobile`, :guilabel:`Address`,
       :guilabel:`Zip code`, :guilabel:`Locality`
     - Contact details.
   * - :guilabel:`Password`
     - The initial password. It is never shown again. It can be left empty
       and one generated after the account is created (see
       :ref:`reset-password`).
   * - :guilabel:`Password reset required`
     - :guilabel:`Yes` makes the user change their password at their next
       sign-in.
   * - :guilabel:`Department` \*
     - The organization the account is attached to. It decides who
       administers the account, and the :guilabel:`Department path` that
       follows from it.
   * - :guilabel:`Deletion date`
     - The date the account is due to be deleted; not earlier than today.
   * - *Mailbox Settings* section: :guilabel:`Other mailboxes`,
       :guilabel:`Mailbox size`, :guilabel:`Delegates`
     - Mailbox settings. The size is written like ``5GB`` or ``500MB``.
       Delegates are accounts allowed into the mailbox.

Filled automatically, and shown on the card only:

- the :guilabel:`Identifier`, derived from the email address (the part before
  ``@``, in lower case, with a suffix when it is already taken). It is the
  sign-in name and **cannot be changed afterwards**;
- the :guilabel:`Department path`;
- the :guilabel:`Status`, ``Active`` on creation;
- the :guilabel:`Delivery mode`;
- the :guilabel:`Mailing lists` the account belongs to.

.. _email-address:

Email address
~~~~~~~~~~~~~

The server checks two rules each time an entry is saved:

- **the address is unique**: it must be neither the address nor an alias of
  another account or of a group;
- **the domain is allowed**: it must be one of the :guilabel:`Mail domains` of
  the department the entry is attached to, or of one of its parent
  organizations. An account’s address must use one of those domains exactly;
  a group’s address may also use a subdomain of one
  (``all@lists.example.org`` under ``example.org``). When no organization
  declares a domain, every domain is accepted.

A refusal shows with the server’s message; the form stays open for the
correction.

Editing an account
------------------

Open the account’s card, click :guilabel:`Edit`, change the fields, then
:guilabel:`Save`.

.. tip::

   **Moving an account to another department.** Between two organizations of
   one’s scope, change its :guilabel:`Department` field. Towards an
   organization one does not manage, go through the transit organization (see
   :doc:`transit`).

Changing an account’s status
----------------------------

On the card, the :guilabel:`Change state` drop-down list offers the possible
states:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - State
     - Use
   * - :guilabel:`Enabled`
     - The normal state of an account in use.
   * - :guilabel:`Disabled`
     - A suspended account, during a long absence for instance.
   * - :guilabel:`No access`
     - An account kept in the directory but with no access to the services.
   * - :guilabel:`To be deleted`
     - An account marked for deletion.

The change is immediate, with no confirmation; a message confirms it. It is
undone by choosing the former state again.

On the card, the :guilabel:`Status` field shows the names the reference data
gives the states: ``Active``, ``Disabled``, ``No access``, ``To delete``.

.. note::

   What each state actually does (sign-in refused, mailbox kept or not,
   automatic deletion…) depends on the services connected to the directory
   and on their configuration. Ask the operations team.

.. _reset-password:

Resetting a password
--------------------

#. On the account’s card, click :guilabel:`Reset password`.
#. Either:

   - **leave the field empty** to have the server **generate** a password;
   - or type one in :guilabel:`Set a password`.

#. Leave :guilabel:`Require a change at next sign-in` checked (recommended)
   unless there is a reason not to.
#. Click :guilabel:`Confirm`.

A generated password is shown **only once**, in a message at the bottom of
the screen that stays until it is clicked:
:guilabel:`New password: … — copy it now, it will not be shown again`. Copy
it and pass it on to the user through a safe channel before doing anything
else: the next message of the console replaces it.

Deleting an account
-------------------

On the card, click :guilabel:`Delete`, then confirm. Several accounts are
deleted at once from the list (see :doc:`lists`).

.. warning::

   As far as the console is concerned, deletion is permanent. Depending on the
   deployment, the account may go to a trash branch of the directory, from
   which the operations team can restore it — this is not the default. When in
   doubt, prefer the :guilabel:`Disabled` or :guilabel:`To be deleted` state.
