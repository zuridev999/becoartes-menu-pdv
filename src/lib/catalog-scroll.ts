/** Scroll only the list. scrollIntoView can also move clipped ancestors on mobile. */
export function scrollCatalogToSection(container: HTMLElement, section: HTMLElement | null) {
  const top = section
    ? container.scrollTop + section.getBoundingClientRect().top - container.getBoundingClientRect().top - 16
    : 0;
  container.scrollTo({
    top: Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight)),
    behavior: 'auto',
  });
}
