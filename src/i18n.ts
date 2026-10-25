/**
 * Interface wording, in one language at a time.
 *
 * Every string the console shows goes through here. The catalogue holds only
 * *interface* words — action, column heading, empty state — never the name of
 * an entity or an attribute: those come from the schema, which is the
 * deployment's own vocabulary, and translating them here would put one
 * customer's words in the product.
 *
 * @module browser/directory-console/i18n
 */

export type Catalogue = Record<string, string>;

const en: Catalogue = {
  'app.title': 'Twake Directory Manager',
  'app.loading': 'Loading…',
  'app.error': 'Something went wrong',
  'app.retry': 'Retry',
  'app.close': 'Close',
  'app.cancel': 'Cancel',
  'app.save': 'Save',
  'app.create': 'Create',
  'app.edit': 'Edit',
  'app.delete': 'Delete',
  'app.back': 'Back',
  'app.language': 'Language',
  'language.name': 'English',
  'app.logout': 'Sign out',
  'app.notFound': 'There is no page at this address.',
  'app.toOverview': 'Go to the Overview',

  'nav.dashboard': 'Overview',
  'nav.reference': 'Reference data',

  'scope.title': 'You administer',
  'scope.none': 'You administer no branch',
  'scope.nothing':
    'You administer no branch: there is nothing here for you to manage.',
  'scope.unrestricted': 'Unrestricted access',
  'scope.undescribed':
    'Your permissions are not described by the server — it checks each action',
  'scope.unavailable':
    'Your permissions could not be read ({error}) — read-only until they can',
  'scope.read': 'read',
  'scope.write': 'write',
  'scope.delete': 'delete',

  'dashboard.welcome': 'Signed in as {user}',
  'dashboard.welcomeNamed': 'Signed in as {name} ({email})',
  'dashboard.noRightsTitle': 'There is nothing for you to manage here',
  'dashboard.noRightsBody':
    'Your account ({name}) does not administer any part of the directory. If you need to manage users or groups, ask your directory administrator to make you a local administrator of your department.',
  'dashboard.entities': 'What you can manage',
  'dashboard.create': 'New {entity}',
  'dashboard.noCreate': 'Creation not allowed here',

  'list.open': 'Open',
  'list.listEverything': 'List without searching',
  'list.imported': 'Just imported ({count})',
  'list.backToSearch': 'Back to search',
  'list.search': 'Search',
  'list.searchIn': 'in',
  'list.searchAnywhere': 'Every field',
  'list.searchGuard.one': 'Type at least {count} character to search',
  'list.searchGuard.other': 'Type at least {count} characters to search',
  'list.empty': 'Nothing to show',
  'list.noMatch': 'No entry matches this search',
  'list.truncated.one':
    'Only {count} entry is shown; there are more. Search to find the others.',
  'list.truncated.other':
    'Only {count} entries are shown; there are more. Search to find the others.',
  'list.tooMany': 'Too many entries to show them all: narrow the search.',
  'list.failed':
    'The list could not be loaded. If the directory holds many entries, narrow the search.',
  'list.refused': 'You may not see these entries',
  'list.count': '{from}–{to} of {total}',
  'list.perPage': 'Per page',
  'list.previous': 'Previous',
  'list.next': 'Next',
  'list.selected': '{count} selected',
  'list.export': 'Export selection',
  'list.deleteSelected': 'Delete selection',
  'list.selectAll': 'Select all rows on this page',
  'list.selectRow': 'Select this row',

  'detail.attributes': 'Details',
  'detail.relations': 'Related entries',
  'detail.emptyRelations': 'No related entry',
  'detail.more.one':
    'And {count} more entry, not listed here: search the lists to find it.',
  'detail.more.other':
    'And {count} more entries, not listed here: search the lists to find them.',
  'detail.moreUncounted':
    'And more entries than the directory lists at once: search the lists to find them.',
  'detail.actions': 'Actions',
  'detail.notFound': 'This entry no longer exists',
  'detail.refused': 'You may not see this entry',
  'detail.dn': 'Distinguished name (DN)',
  'detail.copy': 'Copy',
  'detail.copied': 'Copied',
  'detail.copyFailed': 'Select the DN to copy it',
  'detail.showEmpty': 'Show empty fields ({count})',
  'detail.technical': 'Technical details',
  'detail.bytes': '{count} bytes',
  'detail.moreActions': 'More',
  'detail.group.identity': 'Identity',
  'detail.group.organization': 'Organization',
  'detail.group.contact': 'Contact',
  'detail.group.mailbox': 'Mailbox',
  'detail.group.lifecycle': 'Lifecycle',

  'groups.section': 'Groups',
  'groups.add': 'Add to a group…',
  'groups.title': 'Add {name} to groups',
  'groups.field': 'Groups to add',
  'groups.search.one': 'Type {count} character of the group’s name',
  'groups.search.other': 'Type {count} characters of the group’s name',
  'groups.confirm': 'Add',
  'groups.added': '{name} added to {groups}',
  'groups.removed': '{name} removed from {group}',
  'groups.remove': 'Remove from {group}',

  'form.badFormat': '{value}: {pattern}',
  'form.required': 'Fields marked with * are required',
  'form.fieldRequired': 'Required',
  'form.optional': 'Optional fields ({count})',
  'form.addValue': 'Press Enter to add a value',
  'form.identifierPreview':
    '{label}: {id} (sign-in name, cannot be changed later).',
  'form.identifierTaken': 'A number is added to it if it is already taken.',
  'form.removeValue': 'Remove {value}',
  'form.none': '—',
  'form.choose': 'Choose…',
  'form.searchPointer.one': 'Type {count} character to search',
  'form.searchPointer.other': 'Type {count} characters to search',
  'form.searchMember.one':
    'Type {count} character of an email address, or a full DN',
  'form.searchMember.other':
    'Type {count} characters of an email address, or a full DN',
  'form.addDn': 'Press Enter to add this DN',
  'form.addExternal': 'Add {address} as an external member',
  'form.managedDomain':
    '{domain} is a domain of this directory: choose the account instead',
  'form.otherDomain':
    'A shared mailbox at {domain} only takes accounts of {domain}',
  'form.searching': 'Searching…',
  'form.filterPointer': 'Type part of a name, or press ↓ to list them all',
  'form.notLinkedAbove':
    'Only a domain an organization above this one links can be linked here',
  'form.notSize':
    'Expected a size such as 4 GB, 500 MB or 100 KB, or a number of bytes',
  'form.sizeHint': 'A size such as 4 GB, 500 MB or 100 KB',
  'form.pastDate': 'Expected a date not earlier than today',
  'form.true': 'Yes',
  'form.false': 'No',
  'import.open': 'Import CSV',
  'import.title': 'Import {entities}',
  'import.intro':
    'Create entries in bulk from a CSV file, as a spreadsheet saves it. Nothing is written before you have seen what each row would do.',
  'import.noteHeader':
    'The first row names the columns. Columns are matched to fields by their name; you can change the match before anything is checked.',
  'import.noteMulti':
    'A field that takes several values takes them in one cell, separated by |.',
  'import.noteReference':
    'A department, a position or a title is written the way it reads in the form: its name, or the whole path of a department.',
  'import.choose': 'Choose a CSV file',
  'import.chooseHint': 'Separated by commas, semicolons or tabs',
  'import.template': 'Download an empty file',
  'import.templateSuffix': 'template',
  'import.emptyFile': 'This file holds no rows to import.',
  'import.read.one': '{count} row read from {file}',
  'import.read.other': '{count} rows read from {file}',
  'import.mappingHelp':
    'Check which field each column fills. A column set to “Ignore” is not imported.',
  'import.column': 'Column',
  'import.example': 'First row',
  'import.attribute': 'Field',
  'import.ignore': 'Ignore',
  'import.unmapped': 'No column fills these required fields: {fields}',
  'import.twice': 'Several columns fill the same field: {fields}',
  'import.otherFile': 'Choose another file',
  'import.check': 'Check the rows',
  'import.checking': 'Checking the rows…',
  'import.ready': 'ready to import',
  'import.invalid': 'with errors, not imported',
  'import.invalidHelp':
    'These rows will be left out. Download them, correct them and import them again.',
  'import.allValid': 'Every row passed the check.',
  'import.serverRules':
    'The server still checks each entry as it creates it — an address already in use, for instance — and refuses those it must.',
  'import.downloadInvalid': 'Download the rows with errors',
  'import.run.one': 'Import {count} entry',
  'import.run.other': 'Import {count} entries',
  'import.line': 'Line',
  'import.problem': 'Problem',
  'import.more': 'And {count} more, in the downloadable file.',
  'import.rejectedSuffix': 'rejected',
  'import.progress.one': '{done} of {total} entry processed',
  'import.progress.other': '{done} of {total} entries processed',
  'import.progressDetail': '{created} created, {failed} refused',
  'import.stop': 'Stop',
  'import.stopping': 'Stopping…',
  'import.created': 'created',
  'import.refused': 'refused by the server',
  'import.notSent': 'not sent, the import was stopped',
  'import.downloadRefused': 'Download the refused rows',
  'import.createdName': 'Name',
  'import.moreCreated':
    'And {count} more: close this panel to see them all in the list.',
  'import.ambiguous': '{field}: “{value}” matches several entries',
  'import.notFound': '{field}: “{value}” not found',
  'import.undecided':
    '{field}: “{value}” is no identifier, and too many entries contain it to rule out another spelling: check it, or use a DN',
  'import.notBoolean': '{field}: “{value}” is neither yes nor no',
  'import.notDate': '{field}: “{value}” is not a date',
  'import.badFormat': '{field}: {hint}',
  'import.pastDate': '{field}: “{value}” is earlier than today',
  'import.notSize': '{field}: “{value}” is not a size, such as 4 GB',
  'import.missing': '{field} is required',
  'import.duplicate': '{field}: “{value}” is already on line {line}',

  'tree.title': 'Organizations',
  'tree.filter': 'Filter',
  'tree.empty': 'Select an organization',
  'tree.addChild': 'New organization here',
  'org.people': 'People ({count})',
  'org.groups': 'Groups ({count})',
  'org.newUserHere': 'New user here',
  'org.newGroupHere': 'New group here',
  'org.nobody': 'No one is attached to {name}.',
  'org.noneManaged': 'None you manage is attached to {name}.',
  'tree.addUnder': 'New organization under {name}',
  'tree.expand': 'Expand {name}',
  'tree.collapse': 'Collapse {name}',
  'tree.leaf': '{name} has no sub-organization',
  'tree.noMatch': 'No organization matches “{filter}”',
  'tree.noMatchOpened':
    'No organization matches “{filter}” among the opened branches',
  'tree.firstMatches.one': 'First match only — type more to narrow',
  'tree.firstMatches.other': 'First {count} matches — type more to narrow',
  'tree.parent': 'Parent organization',

  'status.title': 'Account state',
  'status.change': 'Change state…',
  'status.panelTitle': 'Change state — {name}',
  'status.current': 'Current state: {state}',
  'status.choose': 'New state',
  'status.apply': 'Change state',
  'status.changedFor': '{name} is now {state}',
  'status.action.enabled': 'Enable',
  'status.action.disabled': 'Disable',
  'status.action.noAccess': 'Remove access',
  'status.action.toDelete': 'Mark for deletion',
  'status.help.enabled': 'The normal state of an account in use.',
  'status.help.disabled': 'Suspended, during a long absence for instance.',
  'status.help.noAccess':
    'Kept in the directory, with no access to the services.',
  'status.help.toDelete': 'Marked for deletion.',
  'state.enabled': 'Active',
  'state.disabled': 'Disabled',
  'state.noAccess': 'No access',
  'state.toDelete': 'To delete',

  'password.title': 'Reset password',
  'password.generateHint': 'Leave empty to generate a password',
  'password.choose': 'Set a password',
  'password.forceChange': 'Require a change at next sign-in',
  'password.generatedTitle': 'New password — {name}',
  'password.generatedHelp':
    'Give this password to {name}. It will not be shown again.',
  'password.mustChange': 'They will have to change it when they next sign in.',
  'password.copyFailed': 'Select the password to copy it',
  'password.done': 'Done',
  'password.leaveUncopied': 'Close without copying the password?',
  'password.set': 'Password changed',
  'password.confirmButton': 'Reset password',

  'delete.notEmpty': '{name} is not empty: move or delete its entries first',
  'delete.inUse':
    '{name} is still used by entries ({field}): change them first',
  'delete.title': 'Delete {name}?',
  'delete.irreversible': 'This cannot be undone.',
  'delete.leavesGroups': '{name} will be removed from: {groups}.',
  'delete.groupsUnknown': 'The groups {name} belongs to could not be listed.',
  'delete.preferDisable':
    'To stop access without deleting, set the state to Disabled instead.',
  'delete.button': 'Delete {name}',
  'delete.membersStay.one':
    'Its {count} member stays in the directory; only the group goes.',
  'delete.membersStay.other':
    'Its {count} members stay in the directory; only the group goes.',
  'delete.groupButton': 'Delete group',
  'delete.organizationButton': 'Delete organization',
  'delete.manyTitle.one': 'Delete {count} entry?',
  'delete.manyTitle.other': 'Delete {count} entries?',
  'delete.manyButton.one': 'Delete {count} entry',
  'delete.manyButton.other': 'Delete {count} entries',
  'delete.andMore': 'and {count} more',
  'delete.done': 'Deleted',
  'delete.failed': '{name}: {error}',

  'org.changedAbove':
    '{name} is changed by the administrator above you; you manage what it contains',
  'reference.readOnly':
    'Reference data is kept outside the console: you can read it and use it in forms',
  'transit.branch': 'Transit',
  'transit.badge': 'In transit',
  'transit.claim': 'Claim…',
  'transit.claimTitle': 'Claim {name}',
  'transit.target': 'Into the organization',
  'transit.noTarget': 'You write in no organization that could take it',
  'transit.claimed': '{name} moved to {organization}',
  'transit.handOver': 'Hand over',
  'transit.claimButton': 'Claim into {organization}',
  'transit.handOverTitle': 'Hand {name} over?',
  'transit.handOverLeaves': '{name} leaves {organization} for Transit.',
  'transit.handOverConfirm':
    'Every administrator will see this entry and may claim it; you will no longer manage it.',
  'transit.handedOver': '{name} is in transit',
  'transit.handedOverFrom': '{name} ({from}) is in transit',
  'transit.waiting': 'Waiting in transit ({count})',
  'transit.waitingHelp':
    'Handed over between administrators: claim those that belong to you.',

  'save.done': 'Saved',
  'create.done': 'Created',
  'create.doneNamed': '{name} created',

  'refusal.unique': '{field} “{value}” is already used by another entry.',
  'refusal.domain':
    '{field}: {domain} is not a mail domain of this organization. Allowed: {domains}.',
  'refusal.forbidden':
    'You do not administer {name}: this change is not yours to make.',
  'refusal.server': 'The server refused: {message}',
  'refusal.seeField': 'Not saved: see the highlighted field',

  'nav.policies': 'Password policies',
  'policy.new': 'New policy',
  'policy.name': 'Name',
  'policy.default': 'Default',
  'policy.empty': 'No password policy',
  'policy.column.maxAge': 'Expires after',
  'policy.column.minLength': 'Minimum length',
  'policy.column.lockout': 'Lockout',
  'policy.never': 'Never',
  'policy.noLockout': 'Off',
  'policy.lockoutFor': '{after}, {duration}',
  'policy.untilUnlocked': 'until unlocked',
  'policy.title.new': 'New password policy',
  'policy.title.edit': 'Password policy {name}',
  'policy.group.expiry': 'Expiry',
  'policy.group.quality': 'Quality',
  'policy.group.lockout': 'Lockout',
  'policy.group.changes': 'Changes',
  'policy.group.directory': 'Set in the directory',
  'policy.unitOf': '{field} — unit',
  'policy.unit.days': 'days',
  'policy.unit.hours': 'hours',
  'policy.unit.minutes': 'minutes',
  'policy.unit.seconds': 'seconds',
  'policy.boolean.unset': 'Not set ({value})',
  'policy.boolean.yes': 'Yes',
  'policy.boolean.no': 'No',
  'policy.quality.unset': 'Not set (no check)',
  'policy.quality.0': 'No check',
  'policy.quality.1': 'Check when possible',
  'policy.quality.2': 'Check required',
  'policy.hint.pwdMaxAge': 'Empty or 0: the password never expires',
  'policy.hint.pwdLockoutDuration':
    'Empty or 0: the account stays locked until an administrator unlocks it',
  'policy.hint.pwdCheckModuleArg':
    'Read by the check module slapd loads, ppm for instance: one setting per line',
  'policy.error.name': 'A name is required',
  'policy.error.taken': 'A password policy is already named {name}',
  'policy.error.integer': 'A whole number, 0 or more',
  'policy.created': 'Password policy created',
  'policy.saved': 'Password policy saved',
  'policy.deleted': 'Password policy deleted',
  'policy.deleteTitle': 'Delete the password policy {name}?',
  'policy.deleteButton': 'Delete policy',
  'policy.inUse': '{name} is the default policy, or accounts still use it',
  'policy.lockoutAfter.one': 'After {count} failure',
  'policy.lockoutAfter.other': 'After {count} failures',
  'policy.duration.days.one': '{count} day',
  'policy.duration.days.other': '{count} days',
  'policy.duration.hours.one': '{count} hour',
  'policy.duration.hours.other': '{count} hours',
  'policy.duration.minutes.one': '{count} minute',
  'policy.duration.minutes.other': '{count} minutes',
  'policy.duration.seconds.one': '{count} second',
  'policy.duration.seconds.other': '{count} seconds',
  'policy.attr.pwdMaxAge': 'Password expires after',
  'policy.attr.pwdExpireWarning': 'Warn before expiry',
  'policy.attr.pwdGraceAuthNLimit': 'Sign-ins allowed once expired',
  'policy.attr.pwdGraceExpiry': 'Those sign-ins allowed during',
  'policy.attr.pwdMaxIdle': 'Account unused for',
  'policy.attr.pwdMinAge': 'Minimum time between changes',
  'policy.attr.pwdMinLength': 'Minimum length',
  'policy.attr.pwdMaxLength': 'Maximum length',
  'policy.attr.pwdInHistory': 'Previous passwords refused',
  'policy.attr.pwdCheckQuality': 'Quality check',
  'policy.attr.pwdUseCheckModule': 'Use the check module',
  'policy.attr.pwdCheckModuleArg': 'Check module configuration',
  'policy.attr.pwdLockout': 'Lock accounts out',
  'policy.attr.pwdMaxFailure': 'Failures before lockout',
  'policy.attr.pwdLockoutDuration': 'Lockout lasts',
  'policy.attr.pwdFailureCountInterval': 'Failures forgotten after',
  'policy.attr.pwdMaxRecordedFailure': 'Failures recorded at most',
  'policy.attr.pwdMinDelay': 'Delay after a failure, at first',
  'policy.attr.pwdMaxDelay': 'Delay after a failure, at most',
  'policy.attr.pwdMustChange': 'Change required after a reset',
  'policy.attr.pwdAllowUserChange': 'Users may change their password',
  'policy.attr.pwdSafeModify': 'Current password required to change it',
  'policy.attr.pwdAttribute': 'Applies to',
  'policy.attr.pwdCheckModule': 'Check module',
};

const fr: Catalogue = {
  'app.title': 'Twake Directory Manager',
  'app.loading': 'Chargement…',
  'app.error': 'Une erreur est survenue',
  'app.retry': 'Réessayer',
  'app.close': 'Fermer',
  'app.cancel': 'Annuler',
  'app.save': 'Enregistrer',
  'app.create': 'Créer',
  'app.edit': 'Modifier',
  'app.delete': 'Supprimer',
  'app.back': 'Retour',
  'app.language': 'Langue',
  'language.name': 'Français',
  'app.logout': 'Se déconnecter',
  'app.notFound': 'Il n’y a pas de page à cette adresse.',
  'app.toOverview': 'Aller à l’accueil',

  'nav.dashboard': 'Vue d’ensemble',
  'nav.reference': 'Référentiels',

  'scope.title': 'Vous administrez',
  'scope.none': 'Vous n’administrez aucune branche',
  'scope.nothing':
    'Vous n’administrez aucune branche : il n’y a rien à gérer ici pour vous.',
  'scope.unrestricted': 'Accès sans restriction',
  'scope.undescribed':
    'Vos droits ne sont pas décrits par le serveur — il vérifie chaque action',
  'scope.unavailable':
    'Vos permissions n’ont pas pu être lues ({error}) — lecture seule tant qu’elles ne le sont pas',
  'scope.read': 'lecture',
  'scope.write': 'écriture',
  'scope.delete': 'suppression',

  'dashboard.welcome': 'Connecté en tant que {user}',
  'dashboard.welcomeNamed': 'Connecté en tant que {name} ({email})',
  'dashboard.noRightsTitle': 'Il n’y a rien à gérer ici pour vous',
  'dashboard.noRightsBody':
    'Votre compte ({name}) n’administre aucune partie de l’annuaire. Pour gérer des utilisateurs ou des groupes, demandez à l’administrateur de l’annuaire de vous nommer administrateur local de votre organisation.',
  'dashboard.entities': 'Ce que vous pouvez gérer',
  'dashboard.create': 'Créer : {entity}',
  'dashboard.create.users': 'Créer un utilisateur',
  'dashboard.create.groups': 'Créer un groupe',
  'dashboard.create.organizations': 'Créer une organisation',
  'dashboard.create.positions': 'Créer un poste',
  'dashboard.create.titles': 'Créer une civilité',
  'dashboard.create.accountStatuses': 'Créer un état de compte',
  'dashboard.create.listTypes': 'Créer un type de liste',
  'dashboard.create.mailboxTypes': 'Créer un type de groupe',
  'dashboard.create.domains': 'Créer un domaine',
  'dashboard.noCreate': 'Création non autorisée ici',

  'list.open': 'Ouvrir',
  'list.listEverything': 'Lister sans rechercher',
  'list.imported': 'Dernier import ({count})',
  'list.backToSearch': 'Revenir à la recherche',
  'list.search': 'Rechercher',
  'list.searchIn': 'dans',
  'list.searchAnywhere': 'Tous les champs',
  'list.searchGuard.one':
    'Saisissez au moins {count} caractère pour rechercher',
  'list.searchGuard.other':
    'Saisissez au moins {count} caractères pour rechercher',
  'list.empty': 'Rien à afficher',
  'list.noMatch': 'Aucune entrée ne correspond',
  'list.truncated.one':
    'Seule {count} entrée est affichée ; il y en a d’autres. Utilisez la recherche pour les trouver.',
  'list.truncated.other':
    'Seules {count} entrées sont affichées ; il y en a d’autres. Utilisez la recherche pour les trouver.',
  'list.tooMany':
    'Trop d’entrées pour les afficher toutes : affinez la recherche.',
  'list.failed':
    'La liste n’a pas pu être chargée. Si l’annuaire contient beaucoup d’entrées, affinez la recherche.',
  'list.refused': 'Vous n’avez pas accès à ces entrées',
  'list.count': '{from}–{to} sur {total}',
  'list.perPage': 'Par page',
  'list.previous': 'Précédent',
  'list.next': 'Suivant',
  'list.selected.one': '{count} sélectionné',
  'list.selected.other': '{count} sélectionnés',
  'list.export': 'Exporter la sélection',
  'list.deleteSelected': 'Supprimer la sélection',
  'list.selectAll': 'Sélectionner toutes les lignes de la page',
  'list.selectRow': 'Sélectionner cette ligne',

  'detail.attributes': 'Fiche',
  'detail.relations': 'Entrées liées',
  'detail.emptyRelations': 'Aucune entrée liée',
  'detail.more.one':
    'Et {count} autre entrée, non affichée ici : recherchez-la dans les listes.',
  'detail.more.other':
    'Et {count} autres entrées, non affichées ici : recherchez-les dans les listes.',
  'detail.moreUncounted':
    'Et d’autres entrées, plus que l’annuaire n’en liste d’un coup : recherchez-les dans les listes.',
  'detail.actions': 'Actions',
  'detail.notFound': 'Cette entrée n’existe plus',
  'detail.refused': 'Vous n’avez pas accès à cette entrée',
  'detail.dn': 'Nom distinctif (DN)',
  'detail.copy': 'Copier',
  'detail.copied': 'Copié',
  'detail.copyFailed': 'Sélectionnez le DN pour le copier',
  'detail.showEmpty': 'Afficher les champs vides ({count})',
  'detail.technical': 'Détails techniques',
  'detail.bytes': '{count} octets',
  'detail.moreActions': 'Plus',
  'detail.group.identity': 'Identité',
  'detail.group.organization': 'Organisation',
  'detail.group.contact': 'Coordonnées',
  'detail.group.mailbox': 'Boîte aux lettres',
  'detail.group.lifecycle': 'Cycle de vie',

  'groups.section': 'Groupes',
  'groups.add': 'Ajouter à un groupe…',
  'groups.title': 'Ajouter {name} à des groupes',
  'groups.field': 'Groupes à ajouter',
  'groups.search.one': 'Tapez {count} caractère du nom du groupe',
  'groups.search.other': 'Tapez {count} caractères du nom du groupe',
  'groups.confirm': 'Ajouter',
  'groups.added': '{name} ajouté à {groups}',
  'groups.removed': '{name} retiré de {group}',
  'groups.remove': 'Retirer de {group}',

  'form.badFormat': '{value} : {pattern}',
  'form.required': 'Les champs marqués d’une * sont obligatoires',
  'form.fieldRequired': 'Obligatoire',
  'form.optional': 'Champs facultatifs ({count})',
  'form.addValue': 'Appuyez sur Entrée pour ajouter une valeur',
  'form.identifierPreview':
    '{label} : {id} (nom de connexion, non modifiable ensuite).',
  'form.identifierTaken': 'Un numéro y est ajouté s’il est déjà pris.',
  'form.removeValue': 'Retirer {value}',
  'form.none': '—',
  'form.choose': 'Choisir…',
  'form.searchPointer.one': 'Tapez {count} caractère pour chercher',
  'form.searchPointer.other': 'Tapez {count} caractères pour chercher',
  'form.searchMember.one':
    'Tapez {count} caractère d’une adresse électronique, ou un DN complet',
  'form.searchMember.other':
    'Tapez {count} caractères d’une adresse électronique, ou un DN complet',
  'form.addDn': 'Appuyez sur Entrée pour ajouter ce DN',
  'form.addExternal': 'Ajouter {address} comme membre externe',
  'form.managedDomain':
    '{domain} est un domaine de cet annuaire : choisissez plutôt le compte',
  'form.otherDomain':
    'Une boîte partagée de {domain} n’accepte que des comptes de {domain}',
  'form.searching': 'Recherche…',
  'form.filterPointer':
    'Tapez une partie du nom, ou appuyez sur ↓ pour tout afficher',
  'form.notLinkedAbove':
    'Seul un domaine lié par une organisation au-dessus de celle-ci peut être lié ici',
  'form.notSize':
    'Attendu : une taille telle que 4 GB, 500 MB ou 100 KB, ou un nombre d’octets',
  'form.sizeHint': 'Une taille telle que 4 GB, 500 MB ou 100 KB',
  'form.pastDate': 'Attendu : aujourd’hui ou une date ultérieure',
  'form.true': 'Oui',
  'form.false': 'Non',
  'import.open': 'Importer un CSV',
  'import.title': 'Importer des {lowerEntities}',
  'import.intro':
    'Créez des entrées en masse depuis un fichier CSV, tel qu’un tableur l’enregistre. Rien n’est écrit avant que vous ayez vu ce que ferait chaque ligne.',
  'import.noteHeader':
    'La première ligne nomme les colonnes. Elles sont associées aux champs par leur nom ; vous pouvez corriger l’association avant toute vérification.',
  'import.noteMulti':
    'Un champ à plusieurs valeurs les reçoit dans une seule cellule, séparées par |.',
  'import.noteReference':
    'Une organisation, un poste ou une civilité s’écrit comme il apparaît dans le formulaire : son nom, ou le chemin complet d’une organisation.',
  'import.choose': 'Choisir un fichier CSV',
  'import.chooseHint':
    'Séparé par des virgules, des points-virgules ou des tabulations',
  'import.template': 'Télécharger un fichier vide',
  'import.templateSuffix': 'modele',
  'import.emptyFile': 'Ce fichier ne contient aucune ligne à importer.',
  'import.read.one': '{count} ligne lue dans {file}',
  'import.read.other': '{count} lignes lues dans {file}',
  'import.mappingHelp':
    'Vérifiez le champ que remplit chaque colonne. Une colonne « Ignorer » n’est pas importée.',
  'import.column': 'Colonne',
  'import.example': 'Première ligne',
  'import.attribute': 'Champ',
  'import.ignore': 'Ignorer',
  'import.unmapped':
    'Aucune colonne ne remplit ces champs obligatoires : {fields}',
  'import.twice': 'Plusieurs colonnes remplissent le même champ : {fields}',
  'import.otherFile': 'Choisir un autre fichier',
  'import.check': 'Vérifier les lignes',
  'import.checking': 'Vérification des lignes…',
  'import.ready.one': 'prête à importer',
  'import.ready.other': 'prêtes à importer',
  'import.invalid.one': 'en erreur, non importée',
  'import.invalid.other': 'en erreur, non importées',
  'import.invalidHelp':
    'Ces lignes seront écartées. Téléchargez-les, corrigez-les et importez-les à nouveau.',
  'import.allValid': 'Toutes les lignes ont passé la vérification.',
  'import.serverRules':
    'Le serveur vérifie encore chaque entrée en la créant — une adresse déjà utilisée, par exemple — et refuse celles qu’il doit refuser.',
  'import.downloadInvalid': 'Télécharger les lignes en erreur',
  'import.run.one': 'Importer {count} entrée',
  'import.run.other': 'Importer {count} entrées',
  'import.line': 'Ligne',
  'import.problem': 'Problème',
  'import.more.one': 'Et {count} autre, dans le fichier téléchargeable.',
  'import.more.other': 'Et {count} autres, dans le fichier téléchargeable.',
  'import.rejectedSuffix': 'rejets',
  'import.progress.one': '{done} sur {total} entrée traitée',
  'import.progress.other': '{done} sur {total} entrées traitées',
  'import.progressDetail': 'créées : {created}, refusées : {failed}',
  'import.stop': 'Arrêter',
  'import.stopping': 'Arrêt en cours…',
  'import.created.one': 'créée',
  'import.created.other': 'créées',
  'import.refused.one': 'refusée par le serveur',
  'import.refused.other': 'refusées par le serveur',
  'import.notSent.one': 'non envoyée, l’import a été arrêté',
  'import.notSent.other': 'non envoyées, l’import a été arrêté',
  'import.downloadRefused': 'Télécharger les lignes refusées',
  'import.createdName': 'Nom',
  'import.moreCreated':
    'Et {count} de plus : fermez ce panneau pour retrouver l’ensemble dans la liste.',
  'import.ambiguous': '{field} : « {value} » correspond à plusieurs entrées',
  'import.notFound': '{field} : « {value} » introuvable',
  'import.undecided':
    '{field} : « {value} » n’est pas un identifiant, et trop d’entrées le contiennent pour exclure une autre écriture : vérifiez-le, ou utilisez un DN',
  'import.notBoolean': '{field} : « {value} » n’est ni oui ni non',
  'import.notDate': '{field} : « {value} » n’est pas une date',
  'import.badFormat': '{field} : {hint}',
  'import.pastDate': '{field} : « {value} » est antérieure à aujourd’hui',
  'import.notSize':
    '{field} : « {value} » n’est pas une taille, telle que 4 GB',
  'import.missing': '{field} est obligatoire',
  'import.duplicate': '{field} : « {value} » figure déjà ligne {line}',

  'tree.title': 'Organisations',
  'tree.filter': 'Filtrer',
  'tree.empty': 'Sélectionnez une organisation',
  'tree.addChild': 'Nouvelle organisation ici',
  'org.people': 'Personnes ({count})',
  'org.groups': 'Groupes ({count})',
  'org.newUserHere': 'Nouvel utilisateur ici',
  'org.newGroupHere': 'Nouveau groupe ici',
  'org.nobody': 'Personne n’est rattaché à {name}.',
  'org.noneManaged':
    'Aucune des entrées que vous gérez n’est rattachée à {name}.',
  'tree.addUnder': 'Nouvelle organisation sous {name}',
  'tree.expand': 'Développer {name}',
  'tree.collapse': 'Réduire {name}',
  'tree.leaf': '{name} n’a pas de sous-organisation',
  'tree.noMatch': 'Aucune organisation ne correspond à « {filter} »',
  'tree.noMatchOpened':
    'Aucune organisation ne correspond à « {filter} » parmi les branches ouvertes',
  'tree.firstMatches.one':
    'Première correspondance seulement — précisez le texte pour affiner',
  'tree.firstMatches.other':
    'Les {count} premières correspondances — précisez le texte pour affiner',
  'tree.parent': 'Organisation parente',

  'status.title': 'État du compte',
  'status.change': 'Changer l’état…',
  'status.panelTitle': 'Changer l’état — {name}',
  'status.current': 'État actuel : {state}',
  'status.choose': 'Nouvel état',
  'status.apply': 'Changer l’état',
  'status.changedFor': '{name} est désormais {state}',
  'status.action.enabled': 'Activer',
  'status.action.disabled': 'Désactiver',
  'status.action.noAccess': 'Retirer l’accès',
  'status.action.toDelete': 'Marquer pour suppression',
  'status.help.enabled': 'État normal d’un compte utilisé.',
  'status.help.disabled': 'Suspendu, pendant une longue absence par exemple.',
  'status.help.noAccess': 'Conservé dans l’annuaire, sans accès aux services.',
  'status.help.toDelete': 'Marqué pour suppression.',
  'state.enabled': 'Actif',
  'state.disabled': 'Désactivé',
  'state.noAccess': 'Sans accès',
  'state.toDelete': 'À supprimer',

  'password.title': 'Réinitialiser le mot de passe',
  'password.generateHint': 'Laissez vide pour générer un mot de passe',
  'password.choose': 'Définir un mot de passe',
  'password.forceChange': 'Exiger un changement à la prochaine connexion',
  'password.generatedTitle': 'Nouveau mot de passe — {name}',
  'password.generatedHelp':
    'Transmettez ce mot de passe à {name}. Il ne sera plus affiché.',
  'password.mustChange': 'Il devra être changé à la prochaine connexion.',
  'password.copyFailed': 'Sélectionnez le mot de passe pour le copier',
  'password.done': 'Terminé',
  'password.leaveUncopied': 'Fermer sans copier le mot de passe ?',
  'password.set': 'Mot de passe modifié',
  'password.confirmButton': 'Réinitialiser',

  'delete.notEmpty':
    '{name} n’est pas vide : déplacez ou supprimez d’abord ses entrées',
  'delete.inUse':
    '{name} est encore utilisé par des entrées ({field}) : modifiez-les d’abord',
  'delete.title': 'Supprimer {name} ?',
  'delete.irreversible': 'Cette action est irréversible.',
  'delete.leavesGroups': '{name} sera retiré de : {groups}.',
  'delete.groupsUnknown': 'Les groupes de {name} n’ont pas pu être listés.',
  'delete.preferDisable':
    'Pour couper l’accès sans supprimer, passez plutôt l’état à Désactivé.',
  'delete.button': 'Supprimer {name}',
  'delete.membersStay.one':
    'Son {count} membre reste dans l’annuaire ; seul le groupe disparaît.',
  'delete.membersStay.other':
    'Ses {count} membres restent dans l’annuaire ; seul le groupe disparaît.',
  'delete.groupButton': 'Supprimer le groupe',
  'delete.organizationButton': 'Supprimer l’organisation',
  'delete.manyTitle.one': 'Supprimer {count} entrée ?',
  'delete.manyTitle.other': 'Supprimer {count} entrées ?',
  'delete.manyButton.one': 'Supprimer {count} entrée',
  'delete.manyButton.other': 'Supprimer {count} entrées',
  'delete.andMore': 'et {count} de plus',
  'delete.done': 'Supprimé',
  'delete.failed': '{name} : {error}',

  'org.changedAbove':
    '{name} est modifiée par l’administrateur au-dessus de vous ; vous gérez ce qu’elle contient',
  'reference.readOnly':
    'Les référentiels sont tenus hors de la console : vous pouvez les consulter et les utiliser dans les formulaires',
  'transit.branch': 'Transit',
  'transit.badge': 'En transit',
  'transit.claim': 'Rattacher à…',
  'transit.claimTitle': 'Rattacher {name}',
  'transit.target': 'À l’organisation',
  'transit.noTarget':
    'Vous n’écrivez dans aucune organisation qui puisse l’accueillir',
  'transit.claimed': '{name} est désormais dans {organization}',
  'transit.handOver': 'Mettre en transit',
  'transit.claimButton': 'Rattacher à {organization}',
  'transit.handOverTitle': 'Mettre {name} en transit ?',
  'transit.handOverLeaves': '{name} quitte {organization} pour Transit.',
  'transit.handOverConfirm':
    'Tous les administrateurs verront cette entrée et pourront la rattacher ; vous ne la gérerez plus.',
  'transit.handedOver': '{name} est en transit',
  'transit.handedOverFrom': '{name} ({from}) est en transit',
  'transit.waiting': 'En attente en transit ({count})',
  'transit.waitingHelp':
    'Confiés entre administrateurs : rattachez ceux qui vous reviennent.',

  'save.done': 'Enregistré',
  'create.done': 'Créé',
  'create.doneNamed': '{name} est maintenant dans l’annuaire',

  'refusal.unique': '{field} « {value} » : déjà utilisé par une autre entrée.',
  'refusal.domain':
    '{field} : {domain} n’est pas un domaine de messagerie de cette organisation. Autorisés : {domains}.',
  'refusal.forbidden':
    'Vous n’administrez pas {name} : cette modification ne vous revient pas.',
  'refusal.server': 'Le serveur a refusé : {message}',
  'refusal.seeField': 'Non enregistré : voir le champ signalé',

  'nav.policies': 'Politiques de mot de passe',
  'policy.new': 'Nouvelle politique',
  'policy.name': 'Nom',
  'policy.default': 'Par défaut',
  'policy.empty': 'Aucune politique de mot de passe',
  'policy.column.maxAge': 'Expire après',
  'policy.column.minLength': 'Longueur minimale',
  'policy.column.lockout': 'Verrouillage',
  'policy.never': 'Jamais',
  'policy.noLockout': 'Désactivé',
  'policy.lockoutFor': '{after}, {duration}',
  'policy.untilUnlocked': 'jusqu’au déverrouillage',
  'policy.title.new': 'Nouvelle politique de mot de passe',
  'policy.title.edit': 'Politique de mot de passe {name}',
  'policy.group.expiry': 'Expiration',
  'policy.group.quality': 'Qualité',
  'policy.group.lockout': 'Verrouillage',
  'policy.group.changes': 'Changements',
  'policy.group.directory': 'Fixé dans l’annuaire',
  'policy.unitOf': '{field} — unité',
  'policy.unit.days': 'jours',
  'policy.unit.hours': 'heures',
  'policy.unit.minutes': 'minutes',
  'policy.unit.seconds': 'secondes',
  'policy.boolean.unset': 'Non défini ({value})',
  'policy.boolean.yes': 'Oui',
  'policy.boolean.no': 'Non',
  'policy.quality.unset': 'Non défini (aucun contrôle)',
  'policy.quality.0': 'Aucun contrôle',
  'policy.quality.1': 'Contrôle si possible',
  'policy.quality.2': 'Contrôle obligatoire',
  'policy.hint.pwdMaxAge': 'Vide ou 0 : le mot de passe n’expire jamais',
  'policy.hint.pwdLockoutDuration':
    'Vide ou 0 : le compte reste verrouillé jusqu’à ce qu’un administrateur le déverrouille',
  'policy.hint.pwdCheckModuleArg':
    'Lue par le module de contrôle chargé par slapd, ppm par exemple : un réglage par ligne',
  'policy.error.name': 'Un nom est requis',
  'policy.error.taken': 'Une politique de mot de passe s’appelle déjà {name}',
  'policy.error.integer': 'Un nombre entier, 0 ou plus',
  'policy.created': 'Politique de mot de passe créée',
  'policy.saved': 'Politique de mot de passe enregistrée',
  'policy.deleted': 'Politique de mot de passe supprimée',
  'policy.deleteTitle': 'Supprimer la politique de mot de passe {name} ?',
  'policy.deleteButton': 'Supprimer la politique',
  'policy.inUse':
    '{name} est la politique par défaut, ou des comptes l’utilisent encore',
  'policy.lockoutAfter.one': 'Après {count} échec',
  'policy.lockoutAfter.other': 'Après {count} échecs',
  'policy.duration.days.one': '{count} jour',
  'policy.duration.days.other': '{count} jours',
  'policy.duration.hours.one': '{count} heure',
  'policy.duration.hours.other': '{count} heures',
  'policy.duration.minutes.one': '{count} minute',
  'policy.duration.minutes.other': '{count} minutes',
  'policy.duration.seconds.one': '{count} seconde',
  'policy.duration.seconds.other': '{count} secondes',
  'policy.attr.pwdMaxAge': 'Le mot de passe expire après',
  'policy.attr.pwdExpireWarning': 'Avertir avant l’expiration',
  'policy.attr.pwdGraceAuthNLimit': 'Connexions permises après expiration',
  'policy.attr.pwdGraceExpiry': 'Ces connexions permises pendant',
  'policy.attr.pwdMaxIdle': 'Compte inutilisé depuis',
  'policy.attr.pwdMinAge': 'Délai minimal entre deux changements',
  'policy.attr.pwdMinLength': 'Longueur minimale',
  'policy.attr.pwdMaxLength': 'Longueur maximale',
  'policy.attr.pwdInHistory': 'Anciens mots de passe refusés',
  'policy.attr.pwdCheckQuality': 'Contrôle de qualité',
  'policy.attr.pwdUseCheckModule': 'Utiliser le module de contrôle',
  'policy.attr.pwdCheckModuleArg': 'Configuration du module de contrôle',
  'policy.attr.pwdLockout': 'Verrouiller les comptes',
  'policy.attr.pwdMaxFailure': 'Échecs avant verrouillage',
  'policy.attr.pwdLockoutDuration': 'Durée du verrouillage',
  'policy.attr.pwdFailureCountInterval': 'Échecs oubliés après',
  'policy.attr.pwdMaxRecordedFailure': 'Échecs conservés au plus',
  'policy.attr.pwdMinDelay': 'Délai après un échec, au début',
  'policy.attr.pwdMaxDelay': 'Délai après un échec, au plus',
  'policy.attr.pwdMustChange': 'Changement exigé après réinitialisation',
  'policy.attr.pwdAllowUserChange':
    'Les utilisateurs peuvent changer leur mot de passe',
  'policy.attr.pwdSafeModify': 'Mot de passe actuel exigé pour le changer',
  'policy.attr.pwdAttribute': 'S’applique à',
  'policy.attr.pwdCheckModule': 'Module de contrôle',
};

const mn: Catalogue = {
  'app.title': 'Twake Directory Manager',
  'app.loading': 'Ачаалж байна…',
  'app.error': 'Алдаа гарлаа',
  'app.retry': 'Дахин оролдох',
  'app.close': 'Хаах',
  'app.cancel': 'Цуцлах',
  'app.save': 'Хадгалах',
  'app.create': 'Үүсгэх',
  'app.edit': 'Засах',
  'app.delete': 'Устгах',
  'app.back': 'Буцах',
  'app.language': 'Хэл',
  'language.name': 'Монгол',
  'app.logout': 'Гарах',
  'app.notFound': 'Энэ хаягт хуудас алга.',
  'app.toOverview': 'Нүүр хуудас руу очих',

  'nav.dashboard': 'Тойм',
  'nav.reference': 'Лавлах өгөгдөл',

  'scope.title': 'Таны удирддаг хэсэг',
  'scope.none': 'Та ямар ч салбар удирдахгүй',
  'scope.nothing': 'Та ямар ч салбар удирдахгүй тул энд удирдах зүйл алга.',
  'scope.unrestricted': 'Хязгааргүй эрх',
  'scope.undescribed':
    'Таны эрхийг сервер тодорхойлоогүй — үйлдэл бүрийг сервер шалгана',
  'scope.unavailable':
    'Таны эрхийг уншиж чадсангүй ({error}) — уншигдах хүртэл зөвхөн унших горимд',
  'scope.read': 'унших',
  'scope.write': 'бичих',
  'scope.delete': 'устгах',

  'dashboard.welcome': '{user} нэвтэрсэн',
  'dashboard.welcomeNamed': '{name} ({email}) нэвтэрсэн',
  'dashboard.noRightsTitle': 'Энд таны удирдах зүйл алга',
  'dashboard.noRightsBody':
    'Таны бүртгэл ({name}) лавлахын аль ч хэсгийг удирддаггүй. Хэрэглэгч эсвэл бүлэг удирдах шаардлагатай бол лавлахын администратортаа хандаж өөрийн байгууллагын орон нутгийн администратор болгохыг хүснэ үү.',
  'dashboard.entities': 'Таны удирдах боломжтой зүйлс',
  'dashboard.create': 'Шинэ {entity}',
  'dashboard.noCreate': 'Энд үүсгэх эрхгүй',

  'list.open': 'Нээх',
  'list.listEverything': 'Хайлтгүйгээр жагсаах',
  'list.imported': 'Саяхан импортолсон ({count})',
  'list.backToSearch': 'Хайлт руу буцах',
  'list.search': 'Хайх',
  'list.searchIn': 'Хайх талбар:',
  'list.searchAnywhere': 'Бүх талбар',
  'list.searchGuard': 'Хайхын тулд дор хаяж {count} тэмдэгт оруулна уу',
  'list.empty': 'Харуулах зүйл алга',
  'list.noMatch': 'Энэ хайлтад тохирох бичлэг алга',
  'list.truncated':
    'Зөвхөн {count} бичлэг харагдаж байна; бусад нь бас бий. Тэдгээрийг олохын тулд хайна уу.',
  'list.tooMany':
    'Бүгдийг харуулахад хэт олон бичлэг байна: хайлтаа нарийсгана уу.',
  'list.failed':
    'Жагсаалтыг ачаалж чадсангүй. Лавлахад олон бичлэг байгаа бол хайлтаа нарийсгана уу.',
  'list.refused': 'Танд эдгээр бичлэгийг харах эрх байхгүй',
  'list.count': '{total}-с {from}–{to}',
  'list.perPage': 'Хуудсанд',
  'list.previous': 'Өмнөх',
  'list.next': 'Дараах',
  'list.selected': '{count} сонгосон',
  'list.export': 'Сонгосныг экспортлох',
  'list.deleteSelected': 'Сонгосныг устгах',
  'list.selectAll': 'Энэ хуудасны бүх мөрийг сонгох',
  'list.selectRow': 'Энэ мөрийг сонгох',

  'detail.attributes': 'Дэлгэрэнгүй',
  'detail.relations': 'Холбоотой бичлэгүүд',
  'detail.emptyRelations': 'Холбоотой бичлэг алга',
  'detail.more':
    'Өөр {count} бичлэг энд харагдахгүй байна: тэдгээрийг жагсаалтаас хайж олно уу.',
  'detail.moreUncounted':
    'Лавлах нэг удаад жагсаахаас олон бичлэг бий: тэдгээрийг жагсаалтаас хайж олно уу.',
  'detail.actions': 'Үйлдлүүд',
  'detail.notFound': 'Энэ бичлэг байхгүй болсон',
  'detail.refused': 'Танд энэ бичлэгийг харах эрх байхгүй',
  'detail.dn': 'Ялгах нэр (DN)',
  'detail.copy': 'Хуулах',
  'detail.copied': 'Хуулагдлаа',
  'detail.copyFailed': 'DN-ийг сонгоод хуулна уу',
  'detail.showEmpty': 'Хоосон талбаруудыг харуулах ({count})',
  'detail.technical': 'Техникийн мэдээлэл',
  'detail.bytes': '{count} байт',
  'detail.moreActions': 'Бусад',
  'detail.group.identity': 'Хувийн мэдээлэл',
  'detail.group.organization': 'Байгууллага',
  'detail.group.contact': 'Холбоо барих',
  'detail.group.mailbox': 'Шуудангийн хайрцаг',
  'detail.group.lifecycle': 'Амьдралын мөчлөг',

  'groups.section': 'Бүлгүүд',
  'groups.add': 'Бүлэгт нэмэх…',
  'groups.title': '{name}-г бүлгүүдэд нэмэх',
  'groups.field': 'Нэмэх бүлгүүд',
  'groups.search': 'Бүлгийн нэрний {count} тэмдэгт оруулна уу',
  'groups.confirm': 'Нэмэх',
  'groups.added': '{name}-г {groups}-д нэмлээ',
  'groups.removed': '{name}-г {group}-ээс хаслаа',
  'groups.remove': '{group}-ээс хасах',

  'form.badFormat': '{value}: {pattern}',
  'form.required': '* тэмдэгтэй талбарыг заавал бөглөнө',
  'form.fieldRequired': 'Заавал бөглөнө',
  'form.optional': 'Заавал бус талбарууд ({count})',
  'form.addValue': 'Утга нэмэхийн тулд Enter дарна уу',
  'form.identifierPreview':
    '{label}: {id} (нэвтрэх нэр, дараа нь өөрчлөх боломжгүй).',
  'form.identifierTaken': 'Аль хэдийн ашиглагдсан бол ард нь дугаар нэмнэ.',
  'form.removeValue': '{value} утгыг хасах',
  'form.none': '—',
  'form.choose': 'Сонгох…',
  'form.searchPointer': 'Хайхын тулд {count} тэмдэгт оруулна уу',
  'form.searchMember':
    'И-мэйл хаягийн {count} тэмдэгт, эсвэл бүтэн DN оруулна уу',
  'form.addDn': 'Энэ DN-ийг нэмэхийн тулд Enter дарна уу',
  'form.addExternal': '{address} хаягийг гадны гишүүнээр нэмэх',
  'form.managedDomain':
    '{domain} нь энэ лавлахын домэйн тул бүртгэлийг нь сонгоно уу',
  'form.otherDomain':
    '{domain} домэйны хамтын шуудангийн хайрцагт зөвхөн {domain} домэйны бүртгэл нэмэх боломжтой',
  'form.searching': 'Хайж байна…',
  'form.filterPointer':
    'Нэрийн хэсгийг бичнэ үү, эсвэл бүгдийг харахын тулд ↓ дарна уу',
  'form.notLinkedAbove':
    'Энд зөвхөн үүнээс дээд байгууллагын холбосон домэйныг холбох боломжтой',
  'form.notSize':
    '4 GB, 500 MB, 100 KB гэх мэт хэмжээ, эсвэл байтын тоо оруулна уу',
  'form.sizeHint': '4 GB, 500 MB, 100 KB гэх мэт хэмжээ',
  'form.pastDate': 'Өнөөдөр эсвэл түүнээс хойшх огноо оруулна уу',
  'form.true': 'Тийм',
  'form.false': 'Үгүй',
  'import.open': 'CSV импортлох',
  'import.title': '{entities} импортлох',
  'import.intro':
    'Хүснэгтийн программын хадгалсан CSV файлаас олон бичлэгийг нэг дор үүсгэнэ. Мөр бүр юу хийхийг харахаас өмнө юу ч бичигдэхгүй.',
  'import.noteHeader':
    'Эхний мөр баганын нэрсийг агуулна. Баганыг нэрээр нь талбартай тааруулна; шалгахаас өмнө тааруулалтыг өөрчилж болно.',
  'import.noteMulti':
    'Олон утга авдаг талбарын утгуудыг нэг нүдэнд | тэмдэгтээр тусгаарлан бичнэ.',
  'import.noteReference':
    'Байгууллага, албан тушаал, цолыг маягт дээр харагддагаар нь бичнэ: нэрээр нь, эсвэл байгууллагын бүтэн замаар.',
  'import.choose': 'CSV файл сонгох',
  'import.chooseHint': 'Таслал, цэг таслал эсвэл табаар тусгаарласан',
  'import.template': 'Хоосон файл татах',
  'import.templateSuffix': 'загвар',
  'import.emptyFile': 'Энэ файлд импортлох мөр алга.',
  'import.read': '{file} файлаас {count} мөр уншлаа',
  'import.mappingHelp':
    'Багана бүр аль талбарыг бөглөхийг шалгана уу. «Алгасах» гэж тохируулсан багана импортлогдохгүй.',
  'import.column': 'Багана',
  'import.example': 'Эхний мөр',
  'import.attribute': 'Талбар',
  'import.ignore': 'Алгасах',
  'import.unmapped':
    'Эдгээр заавал бөглөх талбарыг ямар ч багана бөглөхгүй: {fields}',
  'import.twice': 'Нэг талбарыг хэд хэдэн багана бөглөж байна: {fields}',
  'import.otherFile': 'Өөр файл сонгох',
  'import.check': 'Мөрүүдийг шалгах',
  'import.checking': 'Мөрүүдийг шалгаж байна…',
  'import.ready': 'импортлоход бэлэн',
  'import.invalid': 'алдаатай, импортлохгүй',
  'import.invalidHelp':
    'Эдгээр мөрийг орхино. Тэдгээрийг татаж, засаад дахин импортлоно уу.',
  'import.allValid': 'Бүх мөр шалгалтад тэнцлээ.',
  'import.serverRules':
    'Сервер бичлэг бүрийг үүсгэхдээ дахин шалгаж — жишээ нь аль хэдийн ашиглагдаж буй хаяг — шаардлагатай бол татгалзана.',
  'import.downloadInvalid': 'Алдаатай мөрүүдийг татах',
  'import.run': '{count} бичлэг импортлох',
  'import.line': 'Мөр',
  'import.problem': 'Асуудал',
  'import.more': 'Өөр {count} нь татах файлд байна.',
  'import.rejectedSuffix': 'татгалзсан',
  'import.progress': '{total}-с {done} бичлэг боловсруулсан',
  'import.progressDetail': '{created} үүсгэсэн, {failed} татгалзсан',
  'import.stop': 'Зогсоох',
  'import.stopping': 'Зогсоож байна…',
  'import.created': 'үүсгэсэн',
  'import.refused': 'сервер татгалзсан',
  'import.notSent': 'илгээгээгүй, импортыг зогсоосон',
  'import.downloadRefused': 'Татгалзсан мөрүүдийг татах',
  'import.createdName': 'Нэр',
  'import.moreCreated':
    'Өөр {count} байна: бүгдийг жагсаалтаас харахын тулд энэ самбарыг хаана уу.',
  'import.ambiguous': '{field}: «{value}» хэд хэдэн бичлэгт тохирч байна',
  'import.notFound': '{field}: «{value}» олдсонгүй',
  'import.undecided':
    '{field}: «{value}» нь танигч биш бөгөөд үүнийг агуулсан бичлэг хэт олон тул өөр бичлэгийг үгүйсгэх боломжгүй: шалгана уу, эсвэл DN ашиглана уу',
  'import.notBoolean': '{field}: «{value}» нь тийм ч биш, үгүй ч биш',
  'import.notDate': '{field}: «{value}» нь огноо биш',
  'import.badFormat': '{field}: {hint}',
  'import.pastDate': '{field}: «{value}» нь өнөөдрөөс өмнөх огноо',
  'import.notSize': '{field}: «{value}» нь 4 GB гэх мэт хэмжээ биш',
  'import.missing': '{field} заавал бөглөнө',
  'import.duplicate': '{field}: «{value}» {line}-р мөрөнд аль хэдийн байна',

  'tree.title': 'Байгууллагууд',
  'tree.filter': 'Шүүх',
  'tree.empty': 'Байгууллага сонгоно уу',
  'tree.addChild': 'Энд шинэ байгууллага',
  'org.people': 'Хүмүүс ({count})',
  'org.groups': 'Бүлгүүд ({count})',
  'org.newUserHere': 'Энд шинэ хэрэглэгч',
  'org.newGroupHere': 'Энд шинэ бүлэг',
  'org.nobody': '{name}-д хэн ч хавсаргагдаагүй.',
  'org.noneManaged':
    'Таны удирддаг бичлэгүүдээс {name}-д хавсаргагдсан нь алга.',
  'tree.addUnder': '{name} дор шинэ байгууллага',
  'tree.expand': '{name}-г дэлгэх',
  'tree.collapse': '{name}-г хураах',
  'tree.leaf': '{name} дэд байгууллагагүй',
  'tree.noMatch': '«{filter}»-д тохирох байгууллага алга',
  'tree.noMatchOpened':
    'Нээсэн салбаруудад «{filter}»-д тохирох байгууллага алга',
  'tree.firstMatches':
    'Эхний {count} тохирол — нарийсгахын тулд үргэлжлүүлэн бичнэ үү',
  'tree.parent': 'Дээд байгууллага',

  'status.title': 'Бүртгэлийн төлөв',
  'status.change': 'Төлөв өөрчлөх…',
  'status.panelTitle': 'Төлөв өөрчлөх — {name}',
  'status.current': 'Одоогийн төлөв: {state}',
  'status.choose': 'Шинэ төлөв',
  'status.apply': 'Төлөв өөрчлөх',
  'status.changedFor': '{name} одоо {state} төлөвтэй',
  'status.action.enabled': 'Идэвхжүүлэх',
  'status.action.disabled': 'Идэвхгүй болгох',
  'status.action.noAccess': 'Хандалтыг хасах',
  'status.action.toDelete': 'Устгахаар тэмдэглэх',
  'status.help.enabled': 'Ашиглагдаж буй бүртгэлийн хэвийн төлөв.',
  'status.help.disabled':
    'Түр зогсоосон, жишээ нь удаан хугацааны чөлөөний үед.',
  'status.help.noAccess': 'Лавлахад хадгалагдсан, үйлчилгээнд хандах эрхгүй.',
  'status.help.toDelete': 'Устгахаар тэмдэглэсэн.',
  'state.enabled': 'Идэвхтэй',
  'state.disabled': 'Идэвхгүй',
  'state.noAccess': 'Хандах эрхгүй',
  'state.toDelete': 'Устгагдах',

  'password.title': 'Нууц үг дахин тохируулах',
  'password.generateHint': 'Нууц үг үүсгэхийн тулд талбарыг хоосон орхино уу',
  'password.choose': 'Нууц үг тохируулах',
  'password.forceChange': 'Дараагийн нэвтрэлтэд солихыг шаардах',
  'password.generatedTitle': 'Шинэ нууц үг — {name}',
  'password.generatedHelp':
    'Энэ нууц үгийг {name}-д өгнө үү. Дахин харагдахгүй.',
  'password.mustChange': 'Дараагийн нэвтрэлтэд солих шаардлагатай.',
  'password.copyFailed': 'Нууц үгийг сонгоод хуулна уу',
  'password.done': 'Болсон',
  'password.leaveUncopied': 'Нууц үгийг хуулалгүй хаах уу?',
  'password.set': 'Нууц үг солигдлоо',
  'password.confirmButton': 'Дахин тохируулах',

  'delete.notEmpty':
    '{name} хоосон биш: эхлээд доторх бичлэгүүдийг зөөх эсвэл устгана уу',
  'delete.inUse':
    '{name} бичлэгүүдэд ашиглагдсаар байна ({field}): эхлээд тэдгээрийг өөрчилнө үү',
  'delete.title': '{name}-г устгах уу?',
  'delete.irreversible': 'Үүнийг буцаах боломжгүй.',
  'delete.leavesGroups': '{name}-г дараах бүлгүүдээс хасна: {groups}.',
  'delete.groupsUnknown': '{name} хэрэглэгчийн бүлгүүдийг жагсааж чадсангүй.',
  'delete.preferDisable':
    'Устгалгүйгээр хандалтыг зогсоохын тулд төлөвийг Идэвхгүй болгоно уу.',
  'delete.button': '{name}-г устгах',
  'delete.membersStay':
    'Түүний {count} гишүүн лавлахад үлдэнэ; зөвхөн бүлэг устна.',
  'delete.groupButton': 'Бүлгийг устгах',
  'delete.organizationButton': 'Байгууллагыг устгах',
  'delete.manyTitle': '{count} бичлэг устгах уу?',
  'delete.manyButton': '{count} бичлэг устгах',
  'delete.andMore': 'болон өөр {count}',
  'delete.done': 'Устгагдлаа',
  'delete.failed': '{name}: {error}',

  'org.changedAbove':
    '{name}-ийг таны дээд администратор өөрчилнө; та түүний доторхыг удирдана',
  'reference.readOnly':
    'Лавлах өгөгдлийг консолоос гадуур хөтөлдөг: та үзэж, маягтад ашиглаж болно',
  'transit.branch': 'Дамжуулалт',
  'transit.badge': 'Дамжуулалтад',
  'transit.claim': 'Авах…',
  'transit.claimTitle': '{name}-г авах',
  'transit.target': 'Байгууллага руу',
  'transit.noTarget': 'Үүнийг хүлээн авах байгууллагад танд бичих эрх алга',
  'transit.claimed': '{name}-г {organization} руу шилжүүллээ',
  'transit.handOver': 'Шилжүүлэх',
  'transit.claimButton': '{organization} руу авах',
  'transit.handOverTitle': '{name}-г шилжүүлэх үү?',
  'transit.handOverLeaves':
    '{name} {organization}-с гарч дамжуулалтад шилжинэ.',
  'transit.handOverConfirm':
    'Бүх администратор энэ бичлэгийг харж, авах боломжтой болно; та үүнийг цаашид удирдахгүй.',
  'transit.handedOver': '{name} дамжуулалтад байна',
  'transit.handedOverFrom': '{name} ({from}) дамжуулалтад байна',
  'transit.waiting': 'Дамжуулалтад хүлээгдэж буй ({count})',
  'transit.waitingHelp':
    'Администраторуудын хооронд шилжүүлсэн: өөрт хамаарахыг нь авна уу.',

  'save.done': 'Хадгалагдлаа',
  'create.done': 'Үүсгэгдлээ',
  'create.doneNamed': '{name} үүсгэгдлээ',

  'refusal.unique': '{field} «{value}» өөр бичлэгт ашиглагдаж байна.',
  'refusal.domain':
    '{field}: {domain} энэ байгууллагын шуудангийн домэйн биш. Зөвшөөрөгдсөн: {domains}.',
  'refusal.forbidden':
    'Та {name}-г удирддаггүй тул энэ өөрчлөлтийг хийх боломжгүй.',
  'refusal.server': 'Сервер татгалзсан: {message}',
  'refusal.seeField': 'Хадгалагдсангүй: тэмдэглэсэн талбарыг харна уу',

  'nav.policies': 'Нууц үгийн бодлого',
  'policy.new': 'Шинэ бодлого',
  'policy.name': 'Нэр',
  'policy.default': 'Үндсэн',
  'policy.empty': 'Нууц үгийн бодлого алга',
  'policy.column.maxAge': 'Хүчинтэй хугацаа',
  'policy.column.minLength': 'Хамгийн бага урт',
  'policy.column.lockout': 'Түгжээ',
  'policy.never': 'Хэзээ ч үгүй',
  'policy.noLockout': 'Идэвхгүй',
  'policy.lockoutFor': '{after}, {duration}',
  'policy.untilUnlocked': 'тайлах хүртэл',
  'policy.title.new': 'Шинэ нууц үгийн бодлого',
  'policy.title.edit': '{name} нууц үгийн бодлого',
  'policy.group.expiry': 'Хугацаа',
  'policy.group.quality': 'Чанар',
  'policy.group.lockout': 'Түгжээ',
  'policy.group.changes': 'Солилт',
  'policy.group.directory': 'Лавлахад тогтоосон',
  'policy.unitOf': '{field} — нэгж',
  'policy.unit.days': 'хоног',
  'policy.unit.hours': 'цаг',
  'policy.unit.minutes': 'минут',
  'policy.unit.seconds': 'секунд',
  'policy.boolean.unset': 'Тохируулаагүй ({value})',
  'policy.boolean.yes': 'Тийм',
  'policy.boolean.no': 'Үгүй',
  'policy.quality.unset': 'Тохируулаагүй (шалгахгүй)',
  'policy.quality.0': 'Шалгахгүй',
  'policy.quality.1': 'Боломжтой үед шалгах',
  'policy.quality.2': 'Заавал шалгах',
  'policy.hint.pwdMaxAge':
    'Хоосон эсвэл 0: нууц үгийн хугацаа хэзээ ч дуусахгүй',
  'policy.hint.pwdLockoutDuration':
    'Хоосон эсвэл 0: администратор тайлах хүртэл бүртгэл түгжээтэй хэвээр',
  'policy.hint.pwdCheckModuleArg':
    'slapd-ийн ачаалсан шалгах модуль (жишээ нь ppm) уншина: мөр бүрт нэг тохиргоо',
  'policy.error.name': 'Нэр шаардлагатай',
  'policy.error.taken': '{name} нэртэй нууц үгийн бодлого аль хэдийн байна',
  'policy.error.integer': '0 буюу түүнээс их бүхэл тоо',
  'policy.created': 'Нууц үгийн бодлого үүсгэгдлээ',
  'policy.saved': 'Нууц үгийн бодлого хадгалагдлаа',
  'policy.deleted': 'Нууц үгийн бодлого устгагдлаа',
  'policy.deleteTitle': '{name} нууц үгийн бодлогыг устгах уу?',
  'policy.deleteButton': 'Бодлогыг устгах',
  'policy.inUse':
    '{name} нь үндсэн бодлого, эсвэл бүртгэлүүд үүнийг ашигласаар байна',
  'policy.lockoutAfter': '{count} удаа алдсаны дараа',
  'policy.duration.days': '{count} хоног',
  'policy.duration.hours': '{count} цаг',
  'policy.duration.minutes': '{count} минут',
  'policy.duration.seconds': '{count} секунд',
  'policy.attr.pwdMaxAge': 'Нууц үгийн хүчинтэй хугацаа',
  'policy.attr.pwdExpireWarning': 'Хугацаа дуусахаас өмнө анхааруулах',
  'policy.attr.pwdGraceAuthNLimit': 'Хугацаа дууссаны дараах нэвтрэх боломж',
  'policy.attr.pwdGraceExpiry': 'Эдгээр нэвтрэлтийг зөвшөөрөх хугацаа',
  'policy.attr.pwdMaxIdle': 'Бүртгэлийг ашиглаагүй хугацаа',
  'policy.attr.pwdMinAge': 'Солих хоорондын хамгийн бага хугацаа',
  'policy.attr.pwdMinLength': 'Хамгийн бага урт',
  'policy.attr.pwdMaxLength': 'Хамгийн их урт',
  'policy.attr.pwdInHistory': 'Татгалзах өмнөх нууц үгийн тоо',
  'policy.attr.pwdCheckQuality': 'Чанарын шалгалт',
  'policy.attr.pwdUseCheckModule': 'Шалгах модулийг ашиглах',
  'policy.attr.pwdCheckModuleArg': 'Шалгах модулийн тохиргоо',
  'policy.attr.pwdLockout': 'Бүртгэлийг түгжих',
  'policy.attr.pwdMaxFailure': 'Түгжихээс өмнөх алдааны тоо',
  'policy.attr.pwdLockoutDuration': 'Түгжээний хугацаа',
  'policy.attr.pwdFailureCountInterval': 'Алдааг мартах хугацаа',
  'policy.attr.pwdMaxRecordedFailure': 'Хадгалах алдааны дээд тоо',
  'policy.attr.pwdMinDelay': 'Алдааны дараах эхний саатал',
  'policy.attr.pwdMaxDelay': 'Алдааны дараах дээд саатал',
  'policy.attr.pwdMustChange': 'Дахин тохируулсны дараа солихыг шаардах',
  'policy.attr.pwdAllowUserChange': 'Хэрэглэгч нууц үгээ солих боломжтой',
  'policy.attr.pwdSafeModify': 'Солихдоо одоогийн нууц үгийг шаардах',
  'policy.attr.pwdAttribute': 'Хамаарах шинж',
  'policy.attr.pwdCheckModule': 'Шалгах модуль',
};

const catalogues: Record<string, Catalogue> = { en, fr, mn };

/** Languages the console ships with. */
export const availableLanguages = Object.keys(catalogues);

/**
 * What a language is called in itself, the way a reader looks for theirs:
 * "Монгол" says something to whoever reads it, "mn" to almost nobody. Each
 * catalogue names its own language, so a new one brings its name with it.
 *
 * @param code a language the console ships with
 * @returns its name, or the code itself when its catalogue gives none
 */
export function languageName(code: string): string {
  return catalogues[code]?.['language.name'] || code;
}

export class Translator {
  private catalogue: Catalogue;
  private readonly plurals: Intl.PluralRules;
  private readonly numbers: Intl.NumberFormat;
  readonly language: string;

  /**
   * @param requested language tag, or undefined to follow the browser
   */
  constructor(requested?: string) {
    const wanted =
      requested ||
      (typeof navigator !== 'undefined' ? navigator.language : 'en') ||
      'en';
    const short = wanted.split('-')[0].toLowerCase();
    this.language = catalogues[short] ? short : 'en';
    this.catalogue = catalogues[this.language];
    this.plurals = new Intl.PluralRules(this.language);
    this.numbers = new Intl.NumberFormat(this.language);
  }

  /**
   * Translate a key, substituting `{name}` placeholders.
   *
   * An unknown key returns itself rather than an empty string: a missing
   * translation should be visible, not invisible.
   *
   * A numeric `count` picks the form of the sentence that agrees with it:
   * `key.one`, `key.other`, or whichever category the language's own rules
   * name — French puts 0 with 1, English does not. A catalogue holds the
   * forms its language tells apart and the plain key otherwise, so a
   * language whose nouns do not change after a number writes it once.
   * Numbers are written the reader's way, `1,200` or `1 200`.
   *
   * @param key catalogue key
   * @param values placeholder values
   * @returns the translated string
   */
  t(key: string, values: Record<string, string | number> = {}): string {
    const template = this.template(key, values.count);
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      if (!(name in values)) return match;
      const value = values[name];
      return typeof value === 'number'
        ? this.numbers.format(value)
        : String(value);
    });
  }

  /** The form of a key that agrees with a count, when it has several. */
  private template(key: string, count: string | number | undefined): string {
    if (typeof count === 'number') {
      const form =
        this.catalogue[`${key}.${this.plurals.select(count)}`] ??
        this.catalogue[`${key}.other`];
      if (form !== undefined) return form;
    }
    return this.catalogue[key] ?? key;
  }
}
