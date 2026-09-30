Troubleshooting
===============

I can sign in, but I can do nothing
   The banner reads :guilabel:`You administer no branch`: the account is
   appointed on no organization. Ask a global administrator to add it to the
   :guilabel:`Local administrators` of the organizations concerned (see
   :doc:`scope`).

I was just appointed, but my actions are refused
   Rights are cached by the server for five minutes, and the console reads
   them when the page loads. Wait, reload the page, then try again.

The banner reads “Your permissions could not be read”
   The console could not read the scope and, as a precaution, offers no write
   action. Reload the page. If the message persists, contact the operations
   team and pass on the error shown between brackets.

Every request is refused right after signing in
   The directory may hold several accounts with the same identifier — an old
   account left in a trash branch counts. The server then refuses everything,
   for safety. Contact the operations team.

The page reloaded by itself and I went through the sign-in page
   The session had expired, or had been ended from another application (see
   :doc:`signing-in`). Anything typed in a form and not saved is lost.

The list stays empty
   For users and groups, type at least three characters, or click
   :guilabel:`List everything (may be slow)`. If a search finds nothing, check
   the :guilabel:`in` selector: it may be narrowing the search to a single
   field.

An account I know exists is not in the list
   It is attached to an organization outside one’s scope. Its administrator
   can hand it over through transit (see :doc:`transit`).

A link to an entry shows “This entry no longer exists”
   The entry was deleted or renamed — or it is outside one’s scope, in which
   case the console cannot tell it apart from a missing one.

The New button, Edit or Delete is missing
   The scope does not give the matching right (write or delete), or the
   entry is in transit (see :doc:`transit`).

Edit or Delete is refused on my own organization
   An organization is changed by the administrators of its parent (see
   :doc:`scope`).

A drop-down list in a form is empty
   The matching reference data is empty, or was not loaded by the
   deployment. Contact a global administrator.

The server refuses an email address
   The address is already used by another account, group or alias, or its
   domain is not among the :guilabel:`Mail domains` of the department or of
   its parents (see :ref:`email-address`).

The server refuses to delete an organization
   It still holds sub-organizations or attached entries (see
   :doc:`organizations`).

I lost a generated password
   It cannot be shown again: reset the password once more (see
   :ref:`reset-password`).

An exported value starts with an apostrophe
   The value began with ``=``, ``+``, ``-`` or ``@``: the apostrophe keeps a
   spreadsheet from running it as a formula. Remove it before reusing the
   value.
