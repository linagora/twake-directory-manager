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
  'app.confirm': 'Confirm',
  'app.back': 'Back',
  'app.language': 'Language',
  'app.logout': 'Sign out',

  'nav.dashboard': 'Overview',
  'nav.reference': 'Reference data',

  'scope.title': 'You administer',
  'scope.none': 'You administer no branch',
  'scope.unrestricted': 'Unrestricted access',
  'scope.undescribed':
    'Your permissions are not described by the server — it checks each action',
  'scope.unavailable':
    'Your permissions could not be read ({error}) — read-only until they can',
  'scope.read': 'read',
  'scope.write': 'write',
  'scope.delete': 'delete',

  'dashboard.welcome': 'Signed in as {user}',
  'dashboard.entities': 'What you can manage',
  'dashboard.create': 'New {entity}',
  'dashboard.noCreate': 'Creation not allowed here',

  'list.open': 'Open',
  'list.listEverything': 'List without searching',
  'list.search': 'Search',
  'list.searchIn': 'in',
  'list.searchAnywhere': 'Every field',
  'list.searchGuard': 'Type at least {count} characters to search',
  'list.empty': 'Nothing to show',
  'list.noMatch': 'No entry matches this search',
  'list.truncated':
    'Only {count} entries are shown; there are more. Search to find the others.',
  'list.tooMany': 'Too many entries to show them all: narrow the search.',
  'list.failed':
    'The list could not be loaded. If the directory holds many entries, narrow the search.',
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
  'detail.members': 'Attached entries',
  'detail.emptyRelations': 'No related entry',
  'detail.actions': 'Actions',
  'detail.notFound': 'This entry no longer exists',

  'form.required': 'Fields marked with * are required',
  'form.addValue': 'Press Enter to add a value',
  'form.removeValue': 'Remove this value',
  'form.none': '—',
  'form.choose': 'Choose…',
  'form.searchPointer': 'Type {count} characters to search',
  'form.searching': 'Searching…',
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
  'import.read': '{count} rows read from {file}',
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
  'import.run': 'Import {count} entries',
  'import.line': 'Line',
  'import.problem': 'Problem',
  'import.more': 'And {count} more, in the downloadable file.',
  'import.rejectedSuffix': 'rejected',
  'import.progress': '{done} of {total} entries processed',
  'import.progressDetail': '{created} created, {failed} refused',
  'import.stop': 'Stop',
  'import.stopping': 'Stopping…',
  'import.created': 'created',
  'import.refused': 'refused by the server',
  'import.notSent': 'not sent, the import was stopped',
  'import.downloadRefused': 'Download the refused rows',
  'import.ambiguous': '{field}: “{value}” matches several entries',
  'import.notFound': '{field}: “{value}” not found',
  'import.undecided':
    '{field}: “{value}” is no identifier, and too many entries contain it to rule out another spelling: check it, or use a DN',
  'import.notBoolean': '{field}: “{value}” is neither yes nor no',
  'import.notDate': '{field}: “{value}” is not a date',
  'import.missing': '{field} is required',
  'import.duplicate': '{field}: “{value}” is already on line {line}',

  'tree.title': 'Organizations',
  'tree.filter': 'Filter',
  'tree.empty': 'Select an organization',
  'tree.addChild': 'New organization here',

  'status.title': 'Account state',
  'status.change': 'Change state',
  'status.changed': 'State changed to {state}',
  'state.enabled': 'Enabled',
  'state.disabled': 'Disabled',
  'state.noAccess': 'No access',
  'state.toDelete': 'To be deleted',

  'password.title': 'Reset password',
  'password.generate': 'Generate a password',
  'password.choose': 'Set a password',
  'password.forceChange': 'Require a change at next sign-in',
  'password.generated':
    'New password: {password} — copy it now, it will not be shown again',
  'password.set': 'Password changed',

  'delete.confirm': 'Delete {name}? This cannot be undone.',
  'delete.confirmMany': 'Delete {count} entries? This cannot be undone.',
  'delete.done': 'Deleted',
  'delete.failed': '{name}: {error}',

  'transit.branch': 'Transit',
  'transit.badge': 'In transit',
  'transit.claim': 'Claim…',
  'transit.claimTitle': 'Claim {name}',
  'transit.target': 'Into the organization',
  'transit.noTarget': 'You write in no organization that could take it',
  'transit.claimed': '{name} moved to {organization}',
  'transit.handOver': 'Hand over',
  'transit.handOverConfirm':
    'Put {name} in transit? Every administrator will see this entry and may claim it, and you will no longer manage it.',
  'transit.handedOver': '{name} is in transit',

  'save.done': 'Saved',
  'create.done': 'Created',
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
  'app.confirm': 'Confirmer',
  'app.back': 'Retour',
  'app.language': 'Langue',
  'app.logout': 'Se déconnecter',

  'nav.dashboard': 'Vue d’ensemble',
  'nav.reference': 'Référentiels',

  'scope.title': 'Vous administrez',
  'scope.none': 'Vous n’administrez aucune branche',
  'scope.unrestricted': 'Accès sans restriction',
  'scope.undescribed':
    'Vos droits ne sont pas décrits par le serveur — il vérifie chaque action',
  'scope.unavailable':
    'Vos permissions n’ont pas pu être lues ({error}) — lecture seule tant qu’elles ne le sont pas',
  'scope.read': 'lecture',
  'scope.write': 'écriture',
  'scope.delete': 'suppression',

  'dashboard.welcome': 'Connecté en tant que {user}',
  'dashboard.entities': 'Ce que vous pouvez gérer',
  'dashboard.create': 'Créer : {entity}',
  'dashboard.noCreate': 'Création non autorisée ici',

  'list.open': 'Ouvrir',
  'list.listEverything': 'Lister sans rechercher',
  'list.search': 'Rechercher',
  'list.searchIn': 'dans',
  'list.searchAnywhere': 'Tous les champs',
  'list.searchGuard': 'Saisissez au moins {count} caractères pour rechercher',
  'list.empty': 'Rien à afficher',
  'list.noMatch': 'Aucune entrée ne correspond',
  'list.truncated':
    'Seules {count} entrées sont affichées ; il y en a d’autres. Utilisez la recherche pour les trouver.',
  'list.tooMany':
    'Trop d’entrées pour les afficher toutes : affinez la recherche.',
  'list.failed':
    'La liste n’a pas pu être chargée. Si l’annuaire contient beaucoup d’entrées, affinez la recherche.',
  'list.count': '{from}–{to} sur {total}',
  'list.perPage': 'Par page',
  'list.previous': 'Précédent',
  'list.next': 'Suivant',
  'list.selected': '{count} sélectionné(s)',
  'list.export': 'Exporter la sélection',
  'list.deleteSelected': 'Supprimer la sélection',
  'list.selectAll': 'Sélectionner toutes les lignes de la page',
  'list.selectRow': 'Sélectionner cette ligne',

  'detail.attributes': 'Fiche',
  'detail.relations': 'Entrées liées',
  'detail.members': 'Entrées rattachées',
  'detail.emptyRelations': 'Aucune entrée liée',
  'detail.actions': 'Actions',
  'detail.notFound': 'Cette entrée n’existe plus',

  'form.required': 'Les champs marqués d’une * sont obligatoires',
  'form.addValue': 'Appuyez sur Entrée pour ajouter une valeur',
  'form.removeValue': 'Retirer cette valeur',
  'form.none': '—',
  'form.choose': 'Choisir…',
  'form.searchPointer': 'Tapez {count} caractères pour chercher',
  'form.searching': 'Recherche…',
  'form.true': 'Oui',
  'form.false': 'Non',
  'import.open': 'Importer un CSV',
  'import.title': 'Importer : {entities}',
  'import.intro':
    'Créez des entrées en masse depuis un fichier CSV, tel qu’un tableur l’enregistre. Rien n’est écrit avant que vous ayez vu ce que ferait chaque ligne.',
  'import.noteHeader':
    'La première ligne nomme les colonnes. Elles sont associées aux champs par leur nom ; vous pouvez corriger l’association avant toute vérification.',
  'import.noteMulti':
    'Un champ à plusieurs valeurs les reçoit dans une seule cellule, séparées par |.',
  'import.noteReference':
    'Un département, un poste ou une civilité s’écrit comme il apparaît dans le formulaire : son nom, ou le chemin complet d’un département.',
  'import.choose': 'Choisir un fichier CSV',
  'import.chooseHint':
    'Séparé par des virgules, des points-virgules ou des tabulations',
  'import.template': 'Télécharger un fichier vide',
  'import.templateSuffix': 'modele',
  'import.emptyFile': 'Ce fichier ne contient aucune ligne à importer.',
  'import.read': '{count} lignes lues dans {file}',
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
  'import.ready': 'prêtes à importer',
  'import.invalid': 'en erreur, non importées',
  'import.invalidHelp':
    'Ces lignes seront écartées. Téléchargez-les, corrigez-les et importez-les à nouveau.',
  'import.allValid': 'Toutes les lignes ont passé la vérification.',
  'import.serverRules':
    'Le serveur vérifie encore chaque entrée en la créant — une adresse déjà utilisée, par exemple — et refuse celles qu’il doit refuser.',
  'import.downloadInvalid': 'Télécharger les lignes en erreur',
  'import.run': 'Importer {count} entrées',
  'import.line': 'Ligne',
  'import.problem': 'Problème',
  'import.more': 'Et {count} autres, dans le fichier téléchargeable.',
  'import.rejectedSuffix': 'rejets',
  'import.progress': '{done} entrées traitées sur {total}',
  'import.progressDetail': '{created} créées, {failed} refusées',
  'import.stop': 'Arrêter',
  'import.stopping': 'Arrêt en cours…',
  'import.created': 'créées',
  'import.refused': 'refusées par le serveur',
  'import.notSent': 'non envoyées, l’import a été arrêté',
  'import.downloadRefused': 'Télécharger les lignes refusées',
  'import.ambiguous': '{field} : « {value} » correspond à plusieurs entrées',
  'import.notFound': '{field} : « {value} » introuvable',
  'import.undecided':
    '{field} : « {value} » n’est pas un identifiant, et trop d’entrées le contiennent pour exclure une autre écriture : vérifiez-le, ou utilisez un DN',
  'import.notBoolean': '{field} : « {value} » n’est ni oui ni non',
  'import.notDate': '{field} : « {value} » n’est pas une date',
  'import.missing': '{field} est obligatoire',
  'import.duplicate': '{field} : « {value} » figure déjà ligne {line}',

  'tree.title': 'Organisations',
  'tree.filter': 'Filtrer',
  'tree.empty': 'Sélectionnez une organisation',
  'tree.addChild': 'Nouvelle organisation ici',

  'status.title': 'État du compte',
  'status.change': 'Changer l’état',
  'status.changed': 'État passé à {state}',
  'state.enabled': 'Actif',
  'state.disabled': 'Désactivé',
  'state.noAccess': 'Sans accès',
  'state.toDelete': 'À supprimer',

  'password.title': 'Réinitialiser le mot de passe',
  'password.generate': 'Générer un mot de passe',
  'password.choose': 'Définir un mot de passe',
  'password.forceChange': 'Exiger un changement à la prochaine connexion',
  'password.generated':
    'Nouveau mot de passe : {password} — copiez-le maintenant, il ne sera plus affiché',
  'password.set': 'Mot de passe modifié',

  'delete.confirm': 'Supprimer {name} ? Cette action est irréversible.',
  'delete.confirmMany':
    'Supprimer {count} entrées ? Cette action est irréversible.',
  'delete.done': 'Supprimé',
  'delete.failed': '{name} : {error}',

  'transit.branch': 'Transit',
  'transit.badge': 'En transit',
  'transit.claim': 'Rattacher à…',
  'transit.claimTitle': 'Rattacher {name}',
  'transit.target': 'À l’organisation',
  'transit.noTarget':
    'Vous n’écrivez dans aucune organisation qui puisse l’accueillir',
  'transit.claimed': '{name} est désormais dans {organization}',
  'transit.handOver': 'Mettre en transit',
  'transit.handOverConfirm':
    'Mettre {name} en transit ? Tous les administrateurs verront cette entrée et pourront la rattacher, et vous ne la gérerez plus.',
  'transit.handedOver': '{name} est en transit',

  'save.done': 'Enregistré',
  'create.done': 'Créé',
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
  'app.confirm': 'Батлах',
  'app.back': 'Буцах',
  'app.language': 'Хэл',
  'app.logout': 'Гарах',

  'nav.dashboard': 'Тойм',
  'nav.reference': 'Лавлах өгөгдөл',

  'scope.title': 'Таны удирддаг хэсэг',
  'scope.none': 'Та ямар ч салбар удирдахгүй',
  'scope.unrestricted': 'Хязгааргүй эрх',
  'scope.undescribed':
    'Таны эрхийг сервер тодорхойлоогүй — үйлдэл бүрийг сервер шалгана',
  'scope.unavailable':
    'Таны эрхийг уншиж чадсангүй ({error}) — уншигдах хүртэл зөвхөн унших горимд',
  'scope.read': 'унших',
  'scope.write': 'бичих',
  'scope.delete': 'устгах',

  'dashboard.welcome': '{user} нэвтэрсэн',
  'dashboard.entities': 'Таны удирдах боломжтой зүйлс',
  'dashboard.create': 'Шинэ {entity}',
  'dashboard.noCreate': 'Энд үүсгэх эрхгүй',

  'list.open': 'Нээх',
  'list.listEverything': 'Хайлтгүйгээр жагсаах',
  'list.search': 'Хайх',
  'list.searchIn': 'хаана:',
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
  'detail.members': 'Хавсаргасан бичлэгүүд',
  'detail.emptyRelations': 'Холбоотой бичлэг алга',
  'detail.actions': 'Үйлдлүүд',
  'detail.notFound': 'Энэ бичлэг байхгүй болсон',

  'form.required': '* тэмдэгтэй талбарыг заавал бөглөнө',
  'form.addValue': 'Утга нэмэхийн тулд Enter дарна уу',
  'form.removeValue': 'Энэ утгыг хасах',
  'form.none': '—',
  'form.choose': 'Сонгох…',
  'form.searchPointer': 'Хайхын тулд {count} тэмдэгт оруулна уу',
  'form.searching': 'Хайж байна…',
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
    'Хэлтэс, албан тушаал, цолыг маягт дээр харагддагаар нь бичнэ: нэрээр нь, эсвэл хэлтсийн бүтэн замаар.',
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
  'import.ambiguous': '{field}: «{value}» хэд хэдэн бичлэгт тохирч байна',
  'import.notFound': '{field}: «{value}» олдсонгүй',
  'import.undecided':
    '{field}: «{value}» нь танигч биш бөгөөд үүнийг агуулсан бичлэг хэт олон тул өөр бичлэгийг үгүйсгэх боломжгүй: шалгана уу, эсвэл DN ашиглана уу',
  'import.notBoolean': '{field}: «{value}» нь тийм ч биш, үгүй ч биш',
  'import.notDate': '{field}: «{value}» нь огноо биш',
  'import.missing': '{field} заавал бөглөнө',
  'import.duplicate': '{field}: «{value}» {line}-р мөрөнд аль хэдийн байна',

  'tree.title': 'Байгууллагууд',
  'tree.filter': 'Шүүх',
  'tree.empty': 'Байгууллага сонгоно уу',
  'tree.addChild': 'Энд шинэ байгууллага',

  'status.title': 'Бүртгэлийн төлөв',
  'status.change': 'Төлөв өөрчлөх',
  'status.changed': 'Төлөвийг {state} болгож өөрчиллөө',
  'state.enabled': 'Идэвхтэй',
  'state.disabled': 'Идэвхгүй',
  'state.noAccess': 'Хандах эрхгүй',
  'state.toDelete': 'Устгах',

  'password.title': 'Нууц үг шинэчлэх',
  'password.generate': 'Нууц үг үүсгэх',
  'password.choose': 'Нууц үг тохируулах',
  'password.forceChange': 'Дараагийн нэвтрэлтэд солихыг шаардах',
  'password.generated':
    'Шинэ нууц үг: {password} — одоо хуулж авна уу, дахин харагдахгүй',
  'password.set': 'Нууц үг солигдлоо',

  'delete.confirm': '{name}-г устгах уу? Үүнийг буцаах боломжгүй.',
  'delete.confirmMany': '{count} бичлэг устгах уу? Үүнийг буцаах боломжгүй.',
  'delete.done': 'Устгагдлаа',
  'delete.failed': '{name}: {error}',

  'transit.branch': 'Дамжуулалт',
  'transit.badge': 'Дамжуулалтад',
  'transit.claim': 'Авах…',
  'transit.claimTitle': '{name}-г авах',
  'transit.target': 'Байгууллага руу',
  'transit.noTarget': 'Үүнийг хүлээн авах байгууллагад танд бичих эрх алга',
  'transit.claimed': '{name}-г {organization} руу шилжүүллээ',
  'transit.handOver': 'Шилжүүлэх',
  'transit.handOverConfirm':
    '{name}-г дамжуулалтад оруулах уу? Бүх админ энэ бичлэгийг харж, авах боломжтой болох бөгөөд та үүнийг цаашид удирдахгүй.',
  'transit.handedOver': '{name} дамжуулалтад байна',

  'save.done': 'Хадгалагдлаа',
  'create.done': 'Үүсгэгдлээ',
};

const catalogues: Record<string, Catalogue> = { en, fr, mn };

/** Languages the console ships with. */
export const availableLanguages = Object.keys(catalogues);

export class Translator {
  private catalogue: Catalogue;
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
  }

  /**
   * Translate a key, substituting `{name}` placeholders.
   *
   * An unknown key returns itself rather than an empty string: a missing
   * translation should be visible, not invisible.
   *
   * @param key catalogue key
   * @param values placeholder values
   * @returns the translated string
   */
  t(key: string, values: Record<string, string | number> = {}): string {
    const template = this.catalogue[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match
    );
  }
}
