export function createComponentLibraryTemplate() {
  return `<aside class="catalog glass" aria-label="Component library">
    <div class="catalog-head">
      <div><small>WORKSHOP</small><h2>Component library</h2></div>
      <div class="catalog-actions">
        <button id="clear-build" title="Clear build plate (Shift+Delete)">CLEAR</button>
        <button id="library-add" title="Create component" aria-label="Save selection to My Parts">＋</button>
      </div>
    </div>
    <label class="search">⌕ <input aria-label="Search parts" placeholder="Search parts" /></label>
    <div class="tabs" role="tablist" aria-label="Component categories">
      <button class="active" data-cat="all" role="tab" aria-selected="true" tabindex="0">ALL</button>
      <button data-cat="structure" role="tab" aria-selected="false" tabindex="-1">STRUCTURE</button>
      <button data-cat="motion" role="tab" aria-selected="false" tabindex="-1">MECHANICAL</button>
      <button data-cat="smart" role="tab" aria-selected="false" tabindex="-1">SMART</button>
      <button data-cat="saved" role="tab" aria-selected="false" tabindex="-1">MY PARTS</button>
    </div>
    <div class="part-grid" role="tabpanel"></div>
  </aside>`;
}
