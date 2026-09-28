Reference data
==============

The :guilabel:`Reference data` section of the sidebar gathers the lists of
values the forms pick from. With the default Twake schemas:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - List
     - Used by
   * - :guilabel:`Positions`
     - The :guilabel:`Position` field of accounts.
   * - :guilabel:`Titles`
     - The :guilabel:`Title` field of accounts (Mr, Ms, Dr…).
   * - :guilabel:`Account states`
     - The :guilabel:`Status` of accounts.
   * - :guilabel:`Delivery modes`
     - The :guilabel:`Delivery mode` of accounts.
   * - :guilabel:`Mail domains`
     - The :guilabel:`Mail domains` field of organizations.
   * - :guilabel:`List types`
     - The :guilabel:`List type` field of groups.
   * - :guilabel:`Group types`
     - The :guilabel:`Group type` field of groups.

These lists are browsed like the others (see :doc:`lists`), and shown whole
without having to search.

Who maintains them
------------------

Every administrator can read the reference data. It is stored outside the
organization tree, and rights are granted on the tree: in the usual
deployment, **no administrator — global ones included — can change it from
the console**. There is no :guilabel:`New` or :guilabel:`Import CSV` button
on these lists, and :guilabel:`Edit` or :guilabel:`Delete`, when shown, are
refused by the server.

The reference data is maintained by the operations team. To have a value
added — a new position, a new mail domain — ask them.

.. note::

   **Account states, delivery modes, list types and group types** are
   understood by the services connected to the directory, not only by the
   console: a value those services do not know has no effect, or an
   unexpected one. Adding one is a change of configuration, not of data.
