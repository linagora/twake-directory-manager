Introduction
============

Twake Directory Manager is the administration console of the company
directory. It is where an administrator does the everyday directory work:
create and move accounts, disable them, reset a password, manage the members
of a group, keep the tree of departments in shape.

Who this guide is for
---------------------

Two kinds of administrators use the console. They see the same interface;
only what they are allowed to do in it differs.

Global administrator
   Administers the root organization of the directory, and therefore
   everything under it: every organization, every account, every group. A
   global administrator also appoints the local administrators.

Local administrator
   Administers one or more organizations — a division, a department, a site —
   and everything attached to them: their sub-organizations, their accounts
   and their groups. The rest of the directory is invisible or read-only to
   them.

The :doc:`scope` chapter explains how these rights are granted and how the
console shows them.

Vocabulary
----------

Organization
   A node of the company’s structure: division, department, site…
   Organizations nest into one another to form the **organization tree**.

Attachment
   Every account and every group is attached to an organization (its
   :guilabel:`Department` field). This attachment — not where the entry is
   technically stored in the directory — decides who administers it.

Path
   The full name of an organization, from the first level of the tree below
   the root, for instance ``Human resources / Payroll``. It is computed
   automatically and is never typed by hand.

Account (or user)
   A person of the directory, with their identity, email address, status and
   password.

Group
   A list of members, used as a mailing list or as a permission group.

Reference data
   The lists of values forms pick from: positions, titles, account states,
   mail domains, list types…

Scope
   The organizations an administrator manages, with the rights they hold on
   them (read, write, delete).

Transit
   A special organization used to hand an entry over to another administrator
   (see :doc:`transit`).

.. note::

   The console builds its screens from the description of the directory the
   server gives it: the names of the collections and of the fields, and their
   rules, come from the deployment’s configuration. This guide uses the
   labels of the Twake schemas shipped by default; a directory configured
   otherwise may show other fields or other names.
