import {
  type Download,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

/** A CSV file as the tests write it: a heading row and data rows, `;`-separated by default */
export function csv(rows: string[][], separator = ';'): string {
  return rows.map(row => row.join(separator)).join('\n') + '\n';
}

/**
 * The Import CSV panel of Users, in four steps: the file, the column matching, the check of the
 * rows, the import and its result. A file is handed to its file input directly (no file chooser).
 */
export class ImportPanel {
  readonly page: Page;
  readonly dialog: Locator;
  readonly title: Locator;
  readonly fileInput: Locator;
  /** "Choose a CSV file — Separated by commas, semicolons or tabs" */
  readonly dropZone: Locator;
  readonly templateButton: Locator;
  readonly cancelButton: Locator;
  /** The red messages of the step (empty file, unmapped or doubly mapped fields) */
  readonly errors: Locator;
  /** "2 rows read from x.csv" */
  readonly readLine: Locator;
  readonly mappingRows: Locator;
  readonly otherFileButton: Locator;
  readonly checkButton: Locator;
  /** The counters of the check and of the result: "2 ready to import", "0 with errors…" */
  readonly stats: Locator;
  /** Line / Problem rows of the check or of the result */
  readonly problems: Locator;
  readonly downloadInvalidButton: Locator;
  readonly runButton: Locator;
  readonly backButton: Locator;
  readonly progress: Locator;
  readonly stopButton: Locator;
  readonly downloadRefusedButton: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.fileInput = this.dialog.locator('input[type=file]');
    this.dropZone = this.dialog.locator('.dc-import-drop');
    this.templateButton = this.dialog.locator('[data-import-template]');
    this.cancelButton = this.dialog.locator(
      '.dc-form-actions [data-import-close]'
    );
    this.errors = this.dialog.locator('.dc-panel-body p.dc-error');
    this.readLine = this.dialog.locator('.dc-panel-body p').filter({
      hasText: / (row|rows|ligne|lignes) .+ /,
    });
    this.mappingRows = this.dialog.locator('table.dc-import-mapping tbody tr');
    this.otherFileButton = this.dialog.locator('[data-import-restart]');
    this.checkButton = this.dialog.locator('[data-import-check]');
    this.stats = this.dialog.locator('.dc-import-stat');
    this.problems = this.dialog.locator('.dc-import-problems tbody tr');
    this.downloadInvalidButton = this.dialog.locator('[data-import-report]');
    this.runButton = this.dialog.locator('[data-import-run]');
    this.backButton = this.dialog.locator('[data-import-back]');
    this.progress = this.dialog.getByRole('progressbar');
    this.stopButton = this.dialog.locator('[data-import-stop]');
    this.downloadRefusedButton = this.dialog.locator('[data-import-report]');
    this.closeButton = this.dialog.locator(
      '.dc-form-actions [data-import-close]'
    );
  }

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.title).toHaveText(
      /^(Import Users|Importer : Utilisateurs)$/
    );
  }

  /** Hands a file to the panel, as choosing it would */
  async feed(content: string, name = 'x.csv'): Promise<void> {
    await this.fileInput.setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from(content, 'utf8'),
    });
  }

  /** The Field select of the column named `column` */
  mapping(column: string): Locator {
    return this.dialog.getByRole('combobox', { name: column, exact: true });
  }

  /** The count of a counter of the check or of the result, by its text ("ready to import") */
  stat(label: string | RegExp): Locator {
    return this.stats.filter({ hasText: label }).locator('strong');
  }

  async check(): Promise<void> {
    await this.checkButton.click();
    await expect(this.runButton).toBeVisible();
  }

  /** Imports the rows that passed the check and waits for the result */
  async run(): Promise<void> {
    await this.runButton.click();
    await expect(this.closeButton).toBeVisible({ timeout: 60_000 });
  }

  /** Clicks a download button and returns the file's text */
  async download(button: Locator): Promise<{ name: string; text: string }> {
    const [file] = await Promise.all([
      this.page.waitForEvent('download'),
      button.click(),
    ]);
    return { name: file.suggestedFilename(), text: await readDownload(file) };
  }
}

/** The text of a download */
export async function readDownload(file: Download): Promise<string> {
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}
