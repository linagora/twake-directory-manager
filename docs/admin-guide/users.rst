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
       value ``UNIT``, kept for non-personal accounts. The :guilabel:`?`
       next to the field says so in the form.
   * - :guilabel:`Department` \*
     - The organization the account is attached to. It decides who
       administers the account, and the :guilabel:`Department path` that
       follows from it.
   * - :guilabel:`Last name` \*, :guilabel:`First name` \*,
       :guilabel:`Full name` \*
     - The full name is the one applications show (lists, mail…). It is
       written from the first and last names as they are typed, until it is
       written otherwise; emptied, it follows them again. Whether the first
       name or the last comes first is the deployment’s choice.
   * - :guilabel:`Common name`
     - Technical name of the entry; optional. On a new account it follows
       the full name, until it is written otherwise: the members of a
       group are found by it.
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
   * - :guilabel:`Deletion date`
     - The date the account is due to be deleted; not earlier than today.
   * - *Mailbox Settings* section: :guilabel:`Mailbox size`,
       :guilabel:`Delegates`
     - Mailbox settings. The size is written like ``5GB`` or ``500MB``.
       Delegates are accounts allowed into the mailbox. The
       :guilabel:`Other mailboxes` field is hidden by default (see the
       note below).

Filled automatically, and shown on the card only:

- the :guilabel:`Identifier`, derived from the email address (the part before
  ``@``, in lower case, with a suffix when it is already taken). It is the
  sign-in name and **cannot be changed afterwards**. The form shows it under
  the :guilabel:`Email` field as soon as the address is complete;
- the :guilabel:`Department path`;
- the :guilabel:`Status`, ``Active`` on creation;
- the :guilabel:`Mailing lists` the account belongs to: read from
  ``memberOf`` when the directory maintains it (OpenLDAP's ``memberof``
  overlay), otherwise searched among the groups whose ``member`` holds the
  account's DN (this needs ldap-rest 0.20.1).

.. note::

   :guilabel:`Other mailboxes` and :guilabel:`Delivery mode` have no effect
   in a Twake deployment, so the console hides them by default. They appear
   only when the administrator of the console empties or changes
   ``DM_CONSOLE_HIDDEN_ATTRIBUTES``.

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

Once you type ``@`` in an address or an alias, the form lists the domains
allowed for the entry's department (and, for a group, the directory's
subdomains of those). The first one is selected: :kbd:`Enter` completes
the address with it, :kbd:`↓` and :kbd:`↑` choose another, :kbd:`Esc` closes
the list. Typing the address whole works as before.

Once created, a message names the account.

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

On the card, :guilabel:`Change state…` opens a panel that shows the
account's current state and offers the others, each with a line saying what
it is for:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - State
     - Use
   * - :guilabel:`Active`
     - The normal state of an account in use.
   * - :guilabel:`Disabled`
     - A suspended account, during a long absence for instance.
   * - :guilabel:`No access`
     - An account kept in the directory but with no access to the services.
   * - :guilabel:`To delete`
     - An account marked for deletion.

When a state's entry in :guilabel:`Account states` has a description, the
panel shows that description instead.

Nothing is written until the button naming the choice is pressed:
:guilabel:`Enable`, :guilabel:`Disable`, :guilabel:`Remove access` or
:guilabel:`Mark for deletion`. :guilabel:`Cancel`, × and :kbd:`Escape` leave
the account as it was. A message then names the account and its new state,
for instance "Ada Lovelace is now Disabled". The change is undone by choosing
the former state again.

The states bear the same names in the panel, on the card's
:guilabel:`Status` field, in the lists and in :guilabel:`Account states`.

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
#. Click :guilabel:`Reset password`.

A generated password is shown **only once**, in the same panel, now titled
:guilabel:`New password — <identifier>`. Click :guilabel:`Copy` beside it,
or select it by hand, and pass it on to the user through a safe channel. It
stays until :guilabel:`Done`, :guilabel:`×` or :kbd:`Escape`; closing it
without having clicked :guilabel:`Copy` first asks
:guilabel:`Close without copying the password?`, answered with
:guilabel:`Close` or :guilabel:`Back`. A typed password ends with the message
:guilabel:`Password changed` instead.

Deleting an account
-------------------

On the card, click :guilabel:`Delete`. The confirmation names the account by
its full name, email and organization, to tell two homonyms apart, and lists
the groups it will be removed from. Click :guilabel:`Delete <first name>` to
delete it. To stop access without deleting, follow
:guilabel:`set the state to Disabled instead` in the same dialog: it opens
:guilabel:`Change state…` with :guilabel:`Disabled` picked, and deletes
nothing. Several accounts are deleted at once from the list (see
:doc:`lists`).

The account also leaves what named it: the organizations it managed or
administered, the mailboxes delegated to it, the groups and shared mailboxes
it owned. An account created again at the same address starts with none of
these rights.

.. warning::

   As far as the console is concerned, deletion is permanent. Depending on the
   deployment, the account may go to a trash branch of the directory, from
   which the operations team can restore it — this is not the default; a
   restored account has to be given its rights again. When in doubt, prefer the :guilabel:`Disabled` or :guilabel:`To delete` state.
