import { getAllNotesByPage, NotesByPage, PageNote } from './notesStorage.js';

type NotesJsonExport = {
  exportedAt: string;
  version: number;
  pages: Array<{
    url: string;
    notes: Array<{
      id: string;
      selectedText: string;
      userNote: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
};

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function notesByPageToJsonExport(notesByPage: NotesByPage): NotesJsonExport {
  const pages = Object.entries(notesByPage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, notes]) => ({
      url,
      notes: notes.map((note) => ({
        id: note.id,
        selectedText: note.selectedText,
        userNote: note.userNote,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }))
    }));

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    pages
  };
}

function pageToMarkdown(url: string, notes: PageNote[]): string {
  const lines: string[] = [`## ${url}`, ''];
  notes.forEach((note, index) => {
    lines.push(`### Note ${index + 1}`);
    lines.push('**Selected Text**');
    lines.push(`> ${sanitizeText(note.selectedText).replace(/\n/g, '\n> ') || '(empty)'}`);
    lines.push('');
    lines.push('**My Note**');
    lines.push(sanitizeText(note.userNote) || '(no note)');
    lines.push('');
    lines.push('**Created**');
    lines.push(note.createdAt);
    lines.push('');
    lines.push('**Updated**');
    lines.push(note.updatedAt);
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  return lines.join('\n');
}

function notesByPageToMarkdown(notesByPage: NotesByPage): string {
  const header = [
    '# Polished Notes Export',
    '',
    `Exported at: ${new Date().toISOString()}`,
    ''
  ];

  const sections = Object.entries(notesByPage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, notes]) => pageToMarkdown(url, notes));

  if (sections.length === 0) {
    sections.push('No notes found.');
  }

  return [...header, ...sections].join('\n');
}

function triggerDownload(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function exportAllNotesAsJson(): Promise<string> {
  const notesByPage = await getAllNotesByPage();
  const payload = notesByPageToJsonExport(notesByPage);
  const content = JSON.stringify(payload, null, 2);
  const fileName = `polished-notes-${dateStamp()}.json`;
  triggerDownload(content, fileName, 'application/json;charset=utf-8');
  return fileName;
}

export async function exportAllNotesAsMarkdown(): Promise<string> {
  const notesByPage = await getAllNotesByPage();
  const content = notesByPageToMarkdown(notesByPage);
  const fileName = `polished-notes-${dateStamp()}.md`;
  triggerDownload(content, fileName, 'text/markdown;charset=utf-8');
  return fileName;
}
