import { useMenuStore } from '../../store/menuStore';
import { useFeedback } from '../../store/feedbackStore';
import { useT, type Translate } from '../../i18n/ui';
import { ALLERGENS, TAGS, type Item, type Menu, type Section } from '../../core/schema';
import { t as tx } from '../../core/localize';
import { label as menuLabel } from '../../core/labels';
import { newId } from '../../core/ids';
import { Fieldset, ImageField, LocalizedField, NumberField, Toggle } from '../fields/Fields';
import { EditLocalePicker, useEditLocale } from '../EditLocalePicker';
import { Details } from '../Details';

const noLabels = { labels: {} } as Pick<Menu, 'labels'>;

export function ContentPanel() {
  const menu = useMenuStore((s) => s.menu);
  const update = useMenuStore((s) => s.update);
  const addSection = useMenuStore((s) => s.addSection);
  const { t } = useT();
  const locale = useEditLocale();
  const fb = menu.defaultLocale;

  const field = (key: 'title' | 'subtitle' | 'footerNote') => (next: Menu['title']) =>
    update((m) => ({ ...m, [key]: next }), `menu.${key}.${locale}`);

  return (
    <div className="panel-stack">
      <EditLocalePicker />

      <Fieldset legend={t('menuDetails')}>
        <LocalizedField label={t('title')} value={menu.title} locale={locale} fallbackLocale={fb} onChange={field('title')} maxLength={120} />
        <LocalizedField label={t('subtitle')} value={menu.subtitle} locale={locale} fallbackLocale={fb} onChange={field('subtitle')} maxLength={200} />
        <LocalizedField label={t('footerNote')} value={menu.footerNote} locale={locale} fallbackLocale={fb} onChange={field('footerNote')} multiline />
        <ImageField label={t('logo')} value={menu.logo} locale={locale} fallbackLocale={fb} onChange={(logo) => update((m) => ({ ...m, logo }))} />
        <ImageField label={t('heroImage')} value={menu.hero} locale={locale} fallbackLocale={fb} onChange={(hero) => update((m) => ({ ...m, hero }))} />
      </Fieldset>

      <section className="sections-editor" aria-labelledby="sections-h">
        <h2 id="sections-h" className="panel-title">{t('sections')}</h2>
        {menu.sections.map((section, index) => (
          <SectionEditor key={section.id} section={section} index={index} total={menu.sections.length} locale={locale} fallbackLocale={fb} />
        ))}
        <button type="button" className="btn btn-primary btn-block" onClick={() => addSection()}>
          + {t('addSection')}
        </button>
      </section>
    </div>
  );
}

function SectionEditor({ section, index, total, locale, fallbackLocale }: {
  section: Section; index: number; total: number; locale: string; fallbackLocale: string;
}) {
  const { t } = useT();
  const updateSection = useMenuStore((s) => s.updateSection);
  const moveSection = useMenuStore((s) => s.moveSection);
  const removeSection = useMenuStore((s) => s.removeSection);
  const addItem = useMenuStore((s) => s.addItem);
  const confirm = useFeedback((s) => s.confirm);
  const name = tx(section.title, locale, fallbackLocale) || t('untitledSection');

  const onDelete = async () => {
    if (await confirm(t('confirmDeleteSection', { name }), t('delete'))) removeSection(section.id);
  };

  return (
    <Details
      className="card section-card"
      initialOpen={index === 0 || !tx(section.title, locale, fallbackLocale)}
      summary={<>
        <span className="summary-title">{name}</span>
        <span className="summary-meta">{(section.items.length === 1 ? t('itemsCountOne') : t('itemsCount', { count: section.items.length }))}{section.hidden ? ` · ${t('hidden')}` : ''}</span>
      </>}
    >
      {() => (<>
        <div className="row-actions">
          <button type="button" className="icon-btn" onClick={() => moveSection(section.id, -1)} disabled={index === 0} aria-label={`${t('moveUp')}: ${name}`}>↑</button>
          <button type="button" className="icon-btn" onClick={() => moveSection(section.id, 1)} disabled={index === total - 1} aria-label={`${t('moveDown')}: ${name}`}>↓</button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void onDelete()}>{t('delete')}</button>
        </div>
        <LocalizedField
          label={t('sectionTitle')} value={section.title} locale={locale} fallbackLocale={fallbackLocale} maxLength={120}
          onChange={(title) => updateSection(section.id, (s) => ({ ...s, title }), `s.${section.id}.title.${locale}`)}
        />
        <LocalizedField
          label={t('sectionDescription')} value={section.description} locale={locale} fallbackLocale={fallbackLocale} maxLength={300}
          onChange={(description) => updateSection(section.id, (s) => ({ ...s, description }), `s.${section.id}.desc.${locale}`)}
        />
        <Toggle label={t('hidden')} checked={section.hidden} onChange={(hidden) => updateSection(section.id, (s) => ({ ...s, hidden }))} />
        <ImageField
          label={t('sectionImage')} value={section.image} locale={locale} fallbackLocale={fallbackLocale}
          onChange={(image) => updateSection(section.id, (s) => ({ ...s, image }))}
        />

        <ul className="items-editor">
          {section.items.map((item, i) => (
            <li key={item.id}>
              <ItemEditor sectionId={section.id} item={item} index={i} total={section.items.length} locale={locale} fallbackLocale={fallbackLocale} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-block" onClick={() => addItem(section.id)}>
          + {t('addItem')}
        </button>
      </>)}
    </Details>
  );
}

function ItemEditor({ sectionId, item, index, total, locale, fallbackLocale }: {
  sectionId: string; item: Item; index: number; total: number; locale: string; fallbackLocale: string;
}) {
  const { t, lang } = useT();
  const updateItem = useMenuStore((s) => s.updateItem);
  const moveItem = useMenuStore((s) => s.moveItem);
  const duplicateItem = useMenuStore((s) => s.duplicateItem);
  const removeItem = useMenuStore((s) => s.removeItem);
  const currency = useMenuStore((s) => s.menu.currency);
  const confirm = useFeedback((s) => s.confirm);
  const name = tx(item.name, locale, fallbackLocale) || t('untitledItem');
  const set = (fn: (i: Item) => Item, key?: string) => updateItem(sectionId, item.id, fn, key);
  const k = (field: string) => `i.${item.id}.${field}.${locale}`;

  const onDelete = async () => {
    if (await confirm(t('confirmDeleteItem', { name }), t('delete'))) removeItem(sectionId, item.id);
  };

  return (
    <Details
      className="card item-card"
      initialOpen={!tx(item.name, locale, fallbackLocale)}
      summary={<>
        <span className="summary-title">{name}</span>
        <span className="summary-meta">
          {item.variants.length ? item.variants.map((v) => v.price).join(' / ') : item.price ?? ''}
          {item.soldOut ? ` · ${t('soldOut')}` : ''}
          {item.hidden ? ` · ${t('hidden')}` : ''}
        </span>
      </>}
    >
      {() => (<>
        <div className="row-actions">
          <button type="button" className="icon-btn" onClick={() => moveItem(sectionId, item.id, -1)} disabled={index === 0} aria-label={`${t('moveUp')}: ${name}`}>↑</button>
          <button type="button" className="icon-btn" onClick={() => moveItem(sectionId, item.id, 1)} disabled={index === total - 1} aria-label={`${t('moveDown')}: ${name}`}>↓</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicateItem(sectionId, item.id)}>{t('duplicate')}</button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void onDelete()}>{t('delete')}</button>
        </div>

        <LocalizedField label={t('itemName')} value={item.name} locale={locale} fallbackLocale={fallbackLocale} maxLength={120} onChange={(v) => set((i) => ({ ...i, name: v }), k('name'))} />
        <LocalizedField label={t('itemDescription')} value={item.description} locale={locale} fallbackLocale={fallbackLocale} multiline maxLength={500} onChange={(v) => set((i) => ({ ...i, description: v }), k('desc'))} />

        <div className="grid-2">
          <NumberField label={t('price')} value={item.price} suffix={currency} step={0.5} max={1_000_000} onChange={(price) => set((i) => ({ ...i, price }), `i.${item.id}.price`)} />
          <NumberField label={t('calories')} value={item.calories} max={20_000} onChange={(calories) => set((i) => ({ ...i, calories }), `i.${item.id}.kcal`)} />
        </div>

        <VariantsEditor item={item} locale={locale} fallbackLocale={fallbackLocale} currency={currency} set={set} t={t} />

        <Fieldset legend={t('tags')} className="chips">
          {TAGS.map((tag) => (
            <label key={tag} className="chip">
              <input
                type="checkbox"
                checked={item.tags.includes(tag)}
                onChange={(e) => set((i) => ({ ...i, tags: e.target.checked ? [...i.tags, tag] : i.tags.filter((x) => x !== tag) }))}
              />
              <span>{menuLabel(noLabels, lang, tag)}</span>
            </label>
          ))}
        </Fieldset>

        <Fieldset legend={t('allergens')} className="chips">
          {ALLERGENS.map((a) => (
            <label key={a} className="chip">
              <input
                type="checkbox"
                checked={item.allergens.includes(a)}
                onChange={(e) => set((i) => ({ ...i, allergens: e.target.checked ? [...i.allergens, a] : i.allergens.filter((x) => x !== a) }))}
              />
              <span>{menuLabel(noLabels, lang, a)}</span>
            </label>
          ))}
        </Fieldset>

        <Fieldset legend={t('spiciness')} className="chips">
          {[0, 1, 2, 3].map((level) => (
            <label key={level} className="chip">
              <input type="radio" name={`spicy-${item.id}`} checked={item.spicy === level} onChange={() => set((i) => ({ ...i, spicy: level }))} />
              <span>{level === 0 ? t('spicyNone') : '🌶'.repeat(level)}</span>
            </label>
          ))}
        </Fieldset>

        <div className="grid-2">
          <Toggle label={t('soldOut')} checked={item.soldOut} onChange={(soldOut) => set((i) => ({ ...i, soldOut }))} />
          <Toggle label={t('hidden')} checked={item.hidden} onChange={(hidden) => set((i) => ({ ...i, hidden }))} />
        </div>

        <ImageField label={t('image')} value={item.image} locale={locale} fallbackLocale={fallbackLocale} onChange={(image) => set((i) => ({ ...i, image }))} />
      </>)}
    </Details>
  );
}

function VariantsEditor({ item, locale, fallbackLocale, currency, set, t }: {
  item: Item; locale: string; fallbackLocale: string; currency: string;
  set: (fn: (i: Item) => Item, key?: string) => void; t: Translate;
}) {
  return (
    <Fieldset legend={t('variants')}>
      {item.variants.map((v) => (
        <div key={v.id} className="variant-row">
          <LocalizedField
            label={t('variantLabel')} value={v.label} locale={locale} fallbackLocale={fallbackLocale} maxLength={60}
            onChange={(label) => set((i) => ({ ...i, variants: i.variants.map((x) => (x.id === v.id ? { ...x, label } : x)) }), `v.${v.id}.label.${locale}`)}
          />
          <NumberField
            label={t('price')} value={v.price} suffix={currency} step={0.5} max={1_000_000}
            onChange={(price) => set((i) => ({ ...i, variants: i.variants.map((x) => (x.id === v.id ? { ...x, price: price ?? 0 } : x)) }), `v.${v.id}.price`)}
          />
          <button
            type="button" className="icon-btn" aria-label={`${t('removeVariant')}: ${tx(v.label, locale, fallbackLocale)}`}
            onClick={() => set((i) => ({ ...i, variants: i.variants.filter((x) => x.id !== v.id) }))}
          >
            ×
          </button>
        </div>
      ))}
      {item.variants.length < 8 && (
        <button
          type="button" className="btn btn-sm"
          onClick={() => set((i) => ({ ...i, variants: [...i.variants, { id: newId('v'), label: {}, price: i.price ?? 0 }] }))}
        >
          + {t('addVariant')}
        </button>
      )}
    </Fieldset>
  );
}
