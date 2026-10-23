/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { LabelKey, Menu } from './schema';
import { baseLang } from './locales';

type LabelDict = Record<LabelKey, string>;

const en: LabelDict = {
  soldOut: 'Sold out', spicy: 'Spicy', allergens: 'Allergens', contains: 'Contains', calories: 'kcal',
  language: 'Language', sections: 'Menu sections', reduceMotion: 'Reduce motion', from: 'from',
  vegan: 'Vegan', vegetarian: 'Vegetarian', glutenFree: 'Gluten free', new: 'New', chefPick: "Chef's pick",
  popular: 'Popular', kosher: 'Kosher', halal: 'Halal',
  gluten: 'Gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish', peanuts: 'Peanuts', soy: 'Soy',
  milk: 'Milk', nuts: 'Tree nuts', celery: 'Celery', mustard: 'Mustard', sesame: 'Sesame',
  sulphites: 'Sulphites', lupin: 'Lupin', molluscs: 'Molluscs',
};

/**
 * Built-in translations of the labels printed on the menu itself.
 * Languages not listed fall back to English and can be overridden per menu (Languages panel).
 * Translations should be reviewed by a native speaker before production use.
 */
export const BUILTIN_LABELS: Record<string, LabelDict> = {
  en,
  he: {
    soldOut: 'אזל', spicy: 'חריף', allergens: 'אלרגנים', contains: 'מכיל', calories: 'קק״ל',
    language: 'שפה', sections: 'קטגוריות בתפריט', reduceMotion: 'הפחתת תנועה', from: 'החל מ־',
    vegan: 'טבעוני', vegetarian: 'צמחוני', glutenFree: 'ללא גלוטן', new: 'חדש', chefPick: 'בחירת השף',
    popular: 'מבוקש', kosher: 'כשר', halal: 'חלאל',
    gluten: 'גלוטן', crustaceans: 'סרטנים', eggs: 'ביצים', fish: 'דגים', peanuts: 'בוטנים', soy: 'סויה',
    milk: 'חלב', nuts: 'אגוזים', celery: 'סלרי', mustard: 'חרדל', sesame: 'שומשום',
    sulphites: 'סולפיטים', lupin: 'תורמוס', molluscs: 'רכיכות',
  },
  ar: {
    soldOut: 'نفد', spicy: 'حار', allergens: 'مسببات الحساسية', contains: 'يحتوي على', calories: 'سعرة',
    language: 'اللغة', sections: 'أقسام القائمة', reduceMotion: 'تقليل الحركة', from: 'ابتداءً من',
    vegan: 'نباتي صرف', vegetarian: 'نباتي', glutenFree: 'خالٍ من الغلوتين', new: 'جديد', chefPick: 'اختيار الشيف',
    popular: 'الأكثر طلبًا', kosher: 'كوشر', halal: 'حلال',
    gluten: 'غلوتين', crustaceans: 'قشريات', eggs: 'بيض', fish: 'سمك', peanuts: 'فول سوداني', soy: 'صويا',
    milk: 'حليب', nuts: 'مكسرات', celery: 'كرفس', mustard: 'خردل', sesame: 'سمسم',
    sulphites: 'كبريتيت', lupin: 'ترمس', molluscs: 'رخويات',
  },
  ru: {
    soldOut: 'Нет в наличии', spicy: 'Острое', allergens: 'Аллергены', contains: 'Содержит', calories: 'ккал',
    language: 'Язык', sections: 'Разделы меню', reduceMotion: 'Меньше анимации', from: 'от',
    vegan: 'Веган', vegetarian: 'Вегетарианское', glutenFree: 'Без глютена', new: 'Новинка', chefPick: 'Выбор шефа',
    popular: 'Популярное', kosher: 'Кошерно', halal: 'Халяль',
    gluten: 'Глютен', crustaceans: 'Ракообразные', eggs: 'Яйца', fish: 'Рыба', peanuts: 'Арахис', soy: 'Соя',
    milk: 'Молоко', nuts: 'Орехи', celery: 'Сельдерей', mustard: 'Горчица', sesame: 'Кунжут',
    sulphites: 'Сульфиты', lupin: 'Люпин', molluscs: 'Моллюски',
  },
  fr: {
    soldOut: 'Épuisé', spicy: 'Épicé', allergens: 'Allergènes', contains: 'Contient', calories: 'kcal',
    language: 'Langue', sections: 'Sections du menu', reduceMotion: 'Réduire les animations', from: 'à partir de',
    vegan: 'Végan', vegetarian: 'Végétarien', glutenFree: 'Sans gluten', new: 'Nouveau', chefPick: 'Choix du chef',
    popular: 'Populaire', kosher: 'Casher', halal: 'Halal',
    gluten: 'Gluten', crustaceans: 'Crustacés', eggs: 'Œufs', fish: 'Poisson', peanuts: 'Arachides', soy: 'Soja',
    milk: 'Lait', nuts: 'Fruits à coque', celery: 'Céleri', mustard: 'Moutarde', sesame: 'Sésame',
    sulphites: 'Sulfites', lupin: 'Lupin', molluscs: 'Mollusques',
  },
  es: {
    soldOut: 'Agotado', spicy: 'Picante', allergens: 'Alérgenos', contains: 'Contiene', calories: 'kcal',
    language: 'Idioma', sections: 'Secciones del menú', reduceMotion: 'Reducir movimiento', from: 'desde',
    vegan: 'Vegano', vegetarian: 'Vegetariano', glutenFree: 'Sin gluten', new: 'Nuevo', chefPick: 'Recomendación del chef',
    popular: 'Popular', kosher: 'Kosher', halal: 'Halal',
    gluten: 'Gluten', crustaceans: 'Crustáceos', eggs: 'Huevos', fish: 'Pescado', peanuts: 'Cacahuetes', soy: 'Soja',
    milk: 'Leche', nuts: 'Frutos de cáscara', celery: 'Apio', mustard: 'Mostaza', sesame: 'Sésamo',
    sulphites: 'Sulfitos', lupin: 'Altramuces', molluscs: 'Moluscos',
  },
  de: {
    soldOut: 'Ausverkauft', spicy: 'Scharf', allergens: 'Allergene', contains: 'Enthält', calories: 'kcal',
    language: 'Sprache', sections: 'Menübereiche', reduceMotion: 'Bewegung reduzieren', from: 'ab',
    vegan: 'Vegan', vegetarian: 'Vegetarisch', glutenFree: 'Glutenfrei', new: 'Neu', chefPick: 'Empfehlung des Küchenchefs',
    popular: 'Beliebt', kosher: 'Koscher', halal: 'Halal',
    gluten: 'Gluten', crustaceans: 'Krebstiere', eggs: 'Eier', fish: 'Fisch', peanuts: 'Erdnüsse', soy: 'Soja',
    milk: 'Milch', nuts: 'Schalenfrüchte', celery: 'Sellerie', mustard: 'Senf', sesame: 'Sesam',
    sulphites: 'Sulfite', lupin: 'Lupinen', molluscs: 'Weichtiere',
  },
  it: {
    soldOut: 'Esaurito', spicy: 'Piccante', allergens: 'Allergeni', contains: 'Contiene', calories: 'kcal',
    language: 'Lingua', sections: 'Sezioni del menù', reduceMotion: 'Riduci animazioni', from: 'da',
    vegan: 'Vegano', vegetarian: 'Vegetariano', glutenFree: 'Senza glutine', new: 'Novità', chefPick: 'Scelta dello chef',
    popular: 'Popolare', kosher: 'Kosher', halal: 'Halal',
    gluten: 'Glutine', crustaceans: 'Crostacei', eggs: 'Uova', fish: 'Pesce', peanuts: 'Arachidi', soy: 'Soia',
    milk: 'Latte', nuts: 'Frutta a guscio', celery: 'Sedano', mustard: 'Senape', sesame: 'Sesamo',
    sulphites: 'Solfiti', lupin: 'Lupini', molluscs: 'Molluschi',
  },
  pt: {
    soldOut: 'Esgotado', spicy: 'Picante', allergens: 'Alergénios', contains: 'Contém', calories: 'kcal',
    language: 'Idioma', sections: 'Secções do menu', reduceMotion: 'Reduzir movimento', from: 'a partir de',
    vegan: 'Vegano', vegetarian: 'Vegetariano', glutenFree: 'Sem glúten', new: 'Novo', chefPick: 'Escolha do chef',
    popular: 'Popular', kosher: 'Kosher', halal: 'Halal',
    gluten: 'Glúten', crustaceans: 'Crustáceos', eggs: 'Ovos', fish: 'Peixe', peanuts: 'Amendoins', soy: 'Soja',
    milk: 'Leite', nuts: 'Frutos de casca rija', celery: 'Aipo', mustard: 'Mostarda', sesame: 'Sésamo',
    sulphites: 'Sulfitos', lupin: 'Tremoço', molluscs: 'Moluscos',
  },
  zh: {
    soldOut: '已售罄', spicy: '辣', allergens: '过敏原', contains: '含有', calories: '千卡',
    language: '语言', sections: '菜单分类', reduceMotion: '减少动画', from: '起',
    vegan: '纯素', vegetarian: '素食', glutenFree: '无麸质', new: '新品', chefPick: '主厨推荐',
    popular: '人气', kosher: '洁食', halal: '清真',
    gluten: '麸质', crustaceans: '甲壳类', eggs: '蛋类', fish: '鱼类', peanuts: '花生', soy: '大豆',
    milk: '乳制品', nuts: '坚果', celery: '芹菜', mustard: '芥末', sesame: '芝麻',
    sulphites: '亚硫酸盐', lupin: '羽扇豆', molluscs: '软体动物',
  },
};

/** Resolves a label for a locale: menu override → built-in (exact/base lang) → English. */
export function label(menu: Pick<Menu, 'labels'>, locale: string, key: LabelKey): string {
  const override = menu.labels[locale]?.[key];
  if (override) return override;
  return (BUILTIN_LABELS[locale] ?? BUILTIN_LABELS[baseLang(locale)] ?? en)[key];
}

export function hasBuiltinLabels(locale: string): boolean {
  return Boolean(BUILTIN_LABELS[locale] ?? BUILTIN_LABELS[baseLang(locale)]);
}
