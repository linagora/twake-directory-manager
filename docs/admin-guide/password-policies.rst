Password policies
=================

A password policy sets how long a password lasts, how strong it must be and
when an account is locked out after failed sign-ins. The directory applies
them: the console only edits them.

The :guilabel:`Password policies` page of the sidebar shows them to **global
administrators**. A policy applies across the directory, so local
administrators do not see the page.

The list
--------

Each policy is shown with when its passwords expire, their minimum length
and how it locks accounts out. The policy marked :guilabel:`Default` applies
to every account that is not given another one.

Editing a policy
----------------

Select a policy to open it, or :guilabel:`New policy` to create one. The
fields are grouped:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Group
     - What it sets
   * - :guilabel:`Expiry`
     - How long a password lasts, when to warn before it expires, and the
       sign-ins still allowed once it has.
   * - :guilabel:`Quality`
     - Minimum and maximum length, the number of previous passwords that
       cannot be reused, and the quality check. The
       :guilabel:`Check module configuration` holds the settings of the module
       the directory checks passwords with (ppm, for instance), one per line.
   * - :guilabel:`Lockout`
     - Whether accounts are locked out, after how many failures, and for how
       long.
   * - :guilabel:`Changes`
     - Whether a password must be changed after an administrator resets it,
       and whether users may change their own.

Each field shows the name of the directory attribute it sets. Durations are
typed with their unit. A field left empty removes the setting: the directory
then applies its own default, which the :guilabel:`Not set` choices name.

:guilabel:`Applies to` and :guilabel:`Check module` are shown but cannot be
changed: they are set in the directory's configuration.

Deleting a policy
-----------------

:guilabel:`Delete`, in the policy, is refused while it is the default policy
or while accounts still use it.

.. note::

   The server must know which policy is the default one when there are
   several: ``DM_PPOLICY_DEFAULT_DN`` names it, and ``DM_PPOLICY_BASE`` the
   branch the policies are kept in. Without them, no policy is marked
   :guilabel:`Default` and new ones are created at the top of the directory.
