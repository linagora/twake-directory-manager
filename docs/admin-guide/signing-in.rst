Signing in and out
==================

The console is protected by the company’s single sign-on (SSO), through
OpenID Connect. It has no password of its own: one signs in with one’s usual
account.

Signing in
----------

#. Open the console’s address, given by the operations team. It looks like
   ``https://directory.example.org/static/console/``.
#. The browser is sent to the sign-in page of the company’s identity
   provider. Sign in as usual.
#. Once signed in, the browser comes back to the console, which shows the
   :guilabel:`Overview`.

When an SSO session is already open — because one has just signed in to
another company application, for instance — step 2 goes unnoticed and the
console opens straight away.

.. tip::

   Every screen of the console has an address of its own, which can be
   bookmarked or sent to a colleague: the address of an entry
   (``…/static/console/#/users/jdoe``) opens that entry directly. When a
   sign-in is needed first, one may land on the :guilabel:`Overview`
   instead: open the link a second time.

The first time: what will I see?
--------------------------------

The console only offers what one is allowed to do. The banner at the top of
the screen shows the signed-in administrator’s scope at all times (see
:doc:`scope`).

An account appointed administrator of no organization can sign in, but can do
nothing: the banner reads :guilabel:`You administer no branch`. Ask a global
administrator to be appointed on the organizations concerned.

Signing out
-----------

The :guilabel:`Sign out` button, at the top right, ends the console’s session
**and** the SSO session at the identity provider. Signing out ends on the
identity provider’s own page, which confirms the session is closed; the
console is not shown again.

When the identity provider does not offer this single sign-out, only the
console’s session ends: the browser goes back to the console’s address, and
may be signed straight back in by the provider, whose own session is still
open. Sign out of the provider’s portal as well in that case.

.. important::

   Since the SSO session is closed, the other company applications open in
   the same browser will ask to sign in again too. This is what single
   sign-out is meant to do.

On a shared computer, always sign out explicitly rather than just closing the
tab.

A session that expired or ended elsewhere
-----------------------------------------

The session can end without :guilabel:`Sign out` being clicked:

- it expired, after a period of inactivity or, when the identity provider
  does not renew it, after the lifetime the provider gives it (often an
  hour or less);
- one signed out of another company application, or of the identity
  provider’s portal, and the provider told the console (Back-Channel Logout,
  when the deployment enables it).

In both cases, the next action in the console reloads the page, which goes
through the identity provider’s sign-in page and back to the console. Anything
typed in a form and not yet saved is lost.

.. note::

   If the sign-in page does not show and the console displays an error
   instead, reload the page by hand; if the error persists, see
   :doc:`troubleshooting`.
