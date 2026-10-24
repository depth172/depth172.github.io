const dialog = document.querySelector<HTMLDialogElement>('#app-modal');
const title = document.querySelector<HTMLHeadingElement>('#app-modal-title');
const content = document.querySelector<HTMLDivElement>('#app-modal-content');

if (!dialog || !title || !content) {
  throw new Error('モーダルの要素が見つかりません');
}

const modalDialog = dialog;
const modalTitle = title;
const modalContent = content;

export function openModal(titleText: string, contentHtml: string): void {
  modalTitle.textContent = titleText;
  modalContent.innerHTML = contentHtml;
  if (!modalDialog.open) modalDialog.showModal();
}

modalDialog.addEventListener('click', (event) => {
  if (event.target === modalDialog) modalDialog.close();
});
