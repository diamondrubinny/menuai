/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { SCHEMA_VERSION, designSchema, type Menu, type Item, type Section } from './schema';
import { newId } from './ids';

type L = Record<string, string>;

function item(name: L, description: L, price: number, extra: Partial<Item> = {}): Item {
  return {
    id: newId('i'), name, description, price, variants: [], tags: [], allergens: [],
    spicy: 0, soldOut: false, hidden: false, ...extra,
  };
}

function section(title: L, description: L, items: Item[]): Section {
  return { id: newId('s'), title, description, items, hidden: false };
}

/** A demo menu in Hebrew, English and Arabic. */
export function createSampleMenu(): Menu {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('m'),
    defaultLocale: 'he',
    locales: ['he', 'en', 'ar'],
    currency: 'ILS',
    title: { he: 'לומייר', en: 'Lumière', ar: 'لوميير' },
    subtitle: { he: 'מטבח ים־תיכוני · יין · לילה', en: 'Mediterranean kitchen · Wine · Night', ar: 'مطبخ متوسطي · نبيذ · ليل' },
    footerNote: {
      he: 'יש ליידע את הצוות על כל רגישות או אלרגיה. המחירים כוללים מע״מ.',
      en: 'Please inform our staff of any allergies. Prices include VAT.',
      ar: 'يرجى إبلاغ الطاقم بأي حساسية. الأسعار تشمل ضريبة القيمة المضافة.',
    },
    sections: [
      section(
        { he: 'ראשונות', en: 'Starters', ar: 'مقبلات' },
        { he: 'לחלוק, לטעום, להתחיל לאט', en: 'To share, to taste, to begin slowly', ar: 'للمشاركة والتذوق والبداية على مهل' },
        [
          item(
            { he: 'פוקאצ׳ה מהטאבון', en: 'Taboon focaccia', ar: 'فوكاتشيا من الطابون' },
            { he: 'שמן זית כתית מעולה, מלח ים, עגבניות שרי צלויות', en: 'Extra virgin olive oil, sea salt, roasted cherry tomatoes', ar: 'زيت زيتون بكر، ملح بحر، طماطم كرزية مشوية' },
            32, { tags: ['vegan'], allergens: ['gluten'] },
          ),
          item(
            { he: 'סביצ׳ה דג ים', en: 'Sea fish ceviche', ar: 'سيفيتشي سمك البحر' },
            { he: 'לימון כבוש, צ׳ילי ירוק, כוסברה, שמן קוקוס', en: 'Preserved lemon, green chili, coriander, coconut oil', ar: 'ليمون مخلل، فلفل أخضر، كزبرة، زيت جوز الهند' },
            64, { tags: ['chefPick', 'glutenFree'], allergens: ['fish'], spicy: 2 },
          ),
          item(
            { he: 'חציל על האש', en: 'Fire-roasted eggplant', ar: 'باذنجان على الجمر' },
            { he: 'טחינה גולמית, רימון, שקדים קלויים', en: 'Raw tahini, pomegranate, toasted almonds', ar: 'طحينة، رمان، لوز محمص' },
            46, { tags: ['vegan', 'popular'], allergens: ['sesame', 'nuts'] },
          ),
        ],
      ),
      section(
        { he: 'עיקריות', en: 'Mains', ar: 'أطباق رئيسية' },
        {},
        [
          item(
            { he: 'פילה לברק', en: 'Sea bass fillet', ar: 'فيليه سمك القاروص' },
            { he: 'חמאת עשבי תיבול, פירה שורש סלרי, אספרגוס', en: 'Herb butter, celery root purée, asparagus', ar: 'زبدة الأعشاب، بوريه الكرفس، هليون' },
            128, { allergens: ['fish', 'milk', 'celery'] },
          ),
          item(
            { he: 'ריזוטו פטריות יער', en: 'Wild mushroom risotto', ar: 'ريزوتو الفطر البري' },
            { he: 'פרמזן מיושן, שמן כמהין', en: 'Aged parmesan, truffle oil', ar: 'بارميزان معتق، زيت الكمأة' },
            92, { tags: ['vegetarian', 'new'], allergens: ['milk'] },
          ),
          item(
            { he: 'סטייק אנטריקוט', en: 'Rib-eye steak', ar: 'ستيك ريب آي' },
            { he: 'צלוי על גחלים, צ׳ימיצ׳ורי, תפוחי אדמה פריכים', en: 'Charcoal grilled, chimichurri, crispy potatoes', ar: 'مشوي على الفحم، تشيميتشوري، بطاطا مقرمشة' },
            0, {
              price: undefined,
              tags: ['glutenFree'],
              variants: [
                { id: newId('v'), label: { he: '300 גרם', en: '300 g', ar: '300 غ' }, price: 148 },
                { id: newId('v'), label: { he: '450 גרם', en: '450 g', ar: '450 غ' }, price: 198 },
              ],
            },
          ),
        ],
      ),
      section(
        { he: 'קינוחים', en: 'Desserts', ar: 'حلويات' },
        {},
        [
          item(
            { he: 'קרם ברולה וניל', en: 'Vanilla crème brûlée', ar: 'كريم بروليه بالفانيليا' },
            { he: 'וניל מדגסקר, פירות יער', en: 'Madagascar vanilla, forest berries', ar: 'فانيليا مدغشقر، توت بري' },
            48, { allergens: ['milk', 'eggs'] },
          ),
          item(
            { he: 'טארט שוקולד מריר', en: 'Dark chocolate tart', ar: 'تارت الشوكولاتة الداكنة' },
            { he: '70% קקאו, פלר דה סל, גלידת חלב', en: '70% cacao, fleur de sel, milk ice cream', ar: '70% كاكاو، ملح فلور دو سيل، آيس كريم بالحليب' },
            52, { tags: ['popular'], allergens: ['gluten', 'milk', 'eggs'], soldOut: true },
          ),
        ],
      ),
      section(
        { he: 'משקאות', en: 'Drinks', ar: 'مشروبات' },
        {},
        [
          item(
            { he: 'לימונענע', en: 'Mint lemonade', ar: 'ليموناضة بالنعناع' },
            { he: 'לימונים סחוטים במקום ונענע טרייה', en: 'Freshly squeezed', ar: 'معصورة طازجة' },
            22, { tags: ['vegan'] },
          ),
          item(
            { he: 'יין הבית', en: 'House wine', ar: 'نبيذ البيت' },
            { he: 'אדום / לבן', en: 'Red / White', ar: 'أحمر / أبيض' },
            0, {
              price: undefined,
              allergens: ['sulphites'],
              variants: [
                { id: newId('v'), label: { he: 'כוס', en: 'Glass', ar: 'كأس' }, price: 38 },
                { id: newId('v'), label: { he: 'בקבוק', en: 'Bottle', ar: 'زجاجة' }, price: 160 },
              ],
            },
          ),
        ],
      ),
    ],
    design: designSchema.parse({ theme: 'noir-gold', layout: 'list' }),
    labels: {},
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyMenu(locale = 'he'): Menu {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('m'),
    defaultLocale: locale,
    locales: [locale],
    currency: 'ILS',
    title: {}, subtitle: {}, footerNote: {},
    sections: [section({}, {}, [])],
    design: designSchema.parse({}),
    labels: {},
    updatedAt: new Date().toISOString(),
  };
}
