Importing accounts from a CSV file
==================================

The :guilabel:`Import CSV` button, at the top of the :guilabel:`Users` list,
creates accounts in bulk from a spreadsheet saved as CSV. It is offered next
to the :guilabel:`New user` button, to whoever may create accounts; groups
and organizations have no import.

The import runs in four steps, and **nothing is written before the last
one**.

Step 1 — the file
-----------------

Click :guilabel:`Choose a CSV file` and pick the file. It may be separated by
commas, semicolons or tabs — whatever the spreadsheet saved — and its first
row names the columns.

.. tip::

   :guilabel:`Download an empty file` gives a ready-made file with one column
   per field, named in the interface language. Filling it in is the simplest
   way to get the columns right.

A few rules for the content:

- a field taking **several values** (aliases, for instance) takes them in one
  cell, separated by ``|``: ``j.doe@example.org|john@example.org``;
- a **date** is written ``2027-09-30`` or ``30/09/2027``;
- a **yes/no** field takes ``yes``, ``no``, ``oui``, ``non``, ``true``,
  ``false``, ``1`` or ``0``;
- a **department, position or title** is written the way it reads in the
  form: its name, or the whole path of a department
  (``Human resources / Payroll``).

Step 2 — the columns
--------------------

The console matches each column to a field by its name — the field’s label in
English or French, whatever the case, spacing or accents. The table shows,
for each column, its first value and the field it fills.

Check the matches and correct them where needed with the drop-down lists. A
column set to :guilabel:`Ignore` is not imported.

The step cannot go further when:

- a required field is filled by no column
  (:guilabel:`No column fills these required fields: …`);
- two columns fill the same field
  (:guilabel:`Several columns fill the same field: …`).

:guilabel:`Choose another file` goes back to step 1. When the columns are
right, click :guilabel:`Check the rows`.

Step 3 — the check
------------------

Every row is checked the way the form checks a field — required fields,
formats, yes/no and date values — and every department, position or title is
looked up in the directory. A row repeating a value that must be unique (an
email address, an employee ID) already found on an earlier row is refused,
with the line it repeats.

The result gives the number of rows **ready to import** and of rows **with
errors, not imported**, followed by the first errors, with their line number
and the problem found.

- :guilabel:`Download the rows with errors` downloads them, with the reason
  in a last column: correct them in the spreadsheet and import them again
  later.
- :guilabel:`Back` returns to the columns.
- :guilabel:`Import N entries` starts the import of the valid rows.

Step 4 — the import
-------------------

Each valid row is sent to the server, which creates the entry exactly as if it
had been typed in the form: the same rules and the same rights apply. It may
still refuse some rows — an address already in use in the directory, a
department outside one’s scope — and says why.

A progress bar shows how far the import has got. :guilabel:`Stop` interrupts
it: the entries already created stay created, the others are not sent.

At the end, the result lists the entries **created**, those **refused by the
server** with its message, and, if the import was stopped, those **not
sent**. :guilabel:`Download the refused rows` downloads the refused rows, to
correct and import again.

.. note::

   The identifier of an imported account is generated from its email
   address, as for an account created through the form.
