const CODEBLOCK_LANG_TO_FILE_EXTENSION: Record<string, string> = {
  html: "html",
  css: "css",
  python: "py",
  python3: "py",
  python2: "py",
  javascript: "js",
  typescript: "ts",
  js: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
  ruby: "rb",
  markdown: "md",
  plaintext: "txt",
  text: "txt",
  bash: "sh",
};

export function downloadFile(fileName: string, content: string) {
  const link = document.createElement("a");
  link.href = `data:text/plain;base64,${btoa(content)}`;
  link.download = fileName;

  link.click();
}

export function downloadCodeBlock(className: string, name: string, content: string) {
  const extension = CODEBLOCK_LANG_TO_FILE_EXTENSION[className] ?? className;
  downloadFile(`${name}.${extension.toLowerCase()}`, content);
}
