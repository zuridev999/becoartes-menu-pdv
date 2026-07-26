/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings, PublicLanguageCode, PublicLanguageConfig } from '../types';

export const PUBLIC_LANGUAGE_CODES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type { PublicLanguageCode, PublicLanguageConfig } from '../types';

export const defaultPublicLanguages: PublicLanguageConfig[] = [
  { code: 'pt-BR', name: 'Português', nativeName: 'Português', flag: '🇧🇷', enabled: true },
  { code: 'en-US', name: 'English', nativeName: 'English', flag: '🇺🇸', enabled: true },
  { code: 'es-ES', name: 'Español', nativeName: 'Español', flag: '🇪🇸', enabled: true },
];

const copy: Record<PublicLanguageCode, Record<string, string>> = {
  'pt-BR': {
    language: 'Idioma', menu: 'Cardápio', scanTableQr: 'Escaneie o QR da sua mesa', scanTableQrDescription: 'O cardápio e os pedidos só abrem pelo QR identificado na mesa. Se ele estiver danificado, chame alguém da equipe.', categories: 'Categorias', items: 'itens', item: 'item', search: 'Pesquisar no cardápio', searchPlaceholder: 'Pesquisar...', noItems: 'Nenhum item encontrado', clearSearch: 'Limpe a busca ou escolha outra categoria.', menuGuide: 'Role o cardápio inteiro ou toque para pular até uma categoria.', categoryGuide: 'Toque em uma categoria para ver só aqueles itens.', add: 'Adicionar', addToOrder: 'Adicionar ao pedido', adding: 'Adicionando...', totalItem: 'Total do item', specialInstructions: 'Observações especiais', notesPlaceholder: 'Ex: sem cebola, ponto menos, gelo e limão...', required: 'Obrigatório', chooseOne: 'Escolha 1 adicional', chooseRange: 'Escolha de {{min}} a {{max}}', selectedRemove: 'Selecionado, toque para remover', tapToAdd: 'Toque para adicionar', order: 'Meu pedido', reviewBeforeSending: 'Revise antes de enviar', orderEmpty: 'Seu pedido está vazio', orderSent: 'Pedido já enviado', sentItemsInAccount: 'Os itens enviados estão em Minha conta.', totalOrder: 'Total do pedido', accountTotal: 'Total na minha conta', viewAccount: 'Ver minha conta', sendOrder: 'Enviar pedido', success: 'Pronto!', orderWasSent: 'Seu pedido foi enviado.', removeItem: 'Remover {{name}} do pedido', account: 'Minha conta', noConsumption: 'Nenhum consumo ainda', subtotal: 'Subtotal', serviceFee: 'Taxa de serviço ({{rate}}%)', total: 'Total', paid: 'Já pago', openBalance: 'Saldo em aberto', onlinePayment: 'Pagamento online', choosePayment: 'Escolha como pagar', securePayment: 'Você será direcionado ao ambiente seguro do PagBank. A baixa entra automaticamente após a confirmação.', noOpenBalance: 'Esta conta não tem saldo em aberto.', openTabToPay: 'Abra uma comanda para usar pagamento online.', backToMenu: 'Voltar ao cardápio', payPix: 'Pagar via Pix', payCredit: 'Cartão de crédito', payDebit: 'Cartão de débito', pixDescription: 'Abre o checkout seguro do PagBank.', creditDescription: 'Pague no ambiente protegido do PagBank.', debitDescription: 'Use o checkout hospedado do PagBank.', generating: 'Gerando...', service: 'Atendimento', callWaiter: 'Chamar garçom', closeBill: 'Fechar conta', extraGlass: 'Pedir copo extra', cutlery: 'Pedir talher', helpToday: 'Como podemos ajudar você hoje?', serviceRequest: 'Digite sua solicitação (opcional)', servicePlaceholder: 'Ex: Trazer mais 2 copos com gelo e limão...', sendRequest: 'Enviar solicitação', requestSent: 'Solicitação enviada!', table: 'Mesa', viewBill: 'Ver minha conta', cartItems: '{{count}} {{items}} no pedido', accountItems: '{{count}} {{items}} na minha conta', noConsumptionShort: 'Nenhum consumo lançado ainda', callService: 'Chamar atendimento', close: 'Fechar', languageSettings: 'Idiomas do cardápio', languageSettingsDescription: 'Ative idiomas para o cliente e personalize as cópias quando necessário.', active: 'Ativo', inactive: 'Inativo', publicMenu: 'Cardápio público', catalogTranslationHint: 'Nomes e descrições de produtos permanecem em português até receberem tradução própria no catálogo.',
  },
  'en-US': {
    language: 'Language', menu: 'Menu', scanTableQr: 'Scan your table QR code', scanTableQrDescription: 'The menu and ordering are available only through the QR code assigned to your table. If it is damaged, please ask a team member for help.', categories: 'Categories', items: 'items', item: 'item', search: 'Search the menu', searchPlaceholder: 'Search...', noItems: 'No items found', clearSearch: 'Clear your search or choose another category.', menuGuide: 'Browse the full menu or tap to jump to a category.', categoryGuide: 'Tap a category to see its items.', add: 'Add', addToOrder: 'Add to order', adding: 'Adding...', totalItem: 'Item total', specialInstructions: 'Special instructions', notesPlaceholder: 'E.g. no onion, medium-rare, ice and lemon...', required: 'Required', chooseOne: 'Choose 1 option', chooseRange: 'Choose {{min}} to {{max}}', selectedRemove: 'Selected, tap to remove', tapToAdd: 'Tap to add', order: 'My order', reviewBeforeSending: 'Review before sending', orderEmpty: 'Your order is empty', orderSent: 'Order already sent', sentItemsInAccount: 'Sent items are in My account.', totalOrder: 'Order total', accountTotal: 'Total in my account', viewAccount: 'View my account', sendOrder: 'Send order', success: 'Done!', orderWasSent: 'Your order has been sent.', removeItem: 'Remove {{name}} from order', account: 'My account', noConsumption: 'No orders yet', subtotal: 'Subtotal', serviceFee: 'Service fee ({{rate}}%)', total: 'Total', paid: 'Already paid', openBalance: 'Open balance', onlinePayment: 'Online payment', choosePayment: 'Choose how to pay', securePayment: 'You will be taken to PagBank’s secure payment page. The payment is applied automatically after confirmation.', noOpenBalance: 'This account has no open balance.', openTabToPay: 'Open a tab to use online payment.', backToMenu: 'Back to menu', payPix: 'Pay by Pix', payCredit: 'Credit card', payDebit: 'Debit card', pixDescription: 'Opens PagBank’s secure checkout.', creditDescription: 'Pay in PagBank’s protected environment.', debitDescription: 'Use PagBank’s hosted checkout.', generating: 'Creating...', service: 'Service', callWaiter: 'Call waiter', closeBill: 'Request the bill', extraGlass: 'Request an extra glass', cutlery: 'Request cutlery', helpToday: 'How can we help today?', serviceRequest: 'Write your request (optional)', servicePlaceholder: 'E.g. Please bring 2 more glasses with ice and lemon...', sendRequest: 'Send request', requestSent: 'Request sent!', table: 'Table', viewBill: 'View my account', cartItems: '{{count}} {{items}} in your order', accountItems: '{{count}} {{items}} in your account', noConsumptionShort: 'No orders yet', callService: 'Call service', close: 'Close', languageSettings: 'Menu languages', languageSettingsDescription: 'Enable customer-facing languages and customize the copy when needed.', active: 'Active', inactive: 'Inactive', publicMenu: 'Public menu', catalogTranslationHint: 'Product names and descriptions stay in Portuguese until their own catalog translation is provided.',
  },
  'es-ES': {
    language: 'Idioma', menu: 'Menú', scanTableQr: 'Escanea el QR de tu mesa', scanTableQrDescription: 'El menú y los pedidos solo se abren mediante el QR asignado a tu mesa. Si está dañado, pide ayuda al equipo.', categories: 'Categorías', items: 'artículos', item: 'artículo', search: 'Buscar en el menú', searchPlaceholder: 'Buscar...', noItems: 'No se encontraron artículos', clearSearch: 'Limpia la búsqueda o elige otra categoría.', menuGuide: 'Recorre todo el menú o toca para ir a una categoría.', categoryGuide: 'Toca una categoría para ver sus artículos.', add: 'Agregar', addToOrder: 'Agregar al pedido', adding: 'Agregando...', totalItem: 'Total del artículo', specialInstructions: 'Indicaciones especiales', notesPlaceholder: 'Ej.: sin cebolla, término medio, hielo y limón...', required: 'Obligatorio', chooseOne: 'Elige 1 opción', chooseRange: 'Elige de {{min}} a {{max}}', selectedRemove: 'Seleccionado, toca para quitarlo', tapToAdd: 'Toca para agregar', order: 'Mi pedido', reviewBeforeSending: 'Revisa antes de enviar', orderEmpty: 'Tu pedido está vacío', orderSent: 'Pedido ya enviado', sentItemsInAccount: 'Los artículos enviados están en Mi cuenta.', totalOrder: 'Total del pedido', accountTotal: 'Total en mi cuenta', viewAccount: 'Ver mi cuenta', sendOrder: 'Enviar pedido', success: '¡Listo!', orderWasSent: 'Tu pedido fue enviado.', removeItem: 'Quitar {{name}} del pedido', account: 'Mi cuenta', noConsumption: 'Aún no hay consumos', subtotal: 'Subtotal', serviceFee: 'Servicio ({{rate}}%)', total: 'Total', paid: 'Ya pagado', openBalance: 'Saldo pendiente', onlinePayment: 'Pago en línea', choosePayment: 'Elige cómo pagar', securePayment: 'Serás dirigido al entorno seguro de PagBank. El pago se registra automáticamente tras la confirmación.', noOpenBalance: 'Esta cuenta no tiene saldo pendiente.', openTabToPay: 'Abre una comanda para usar el pago en línea.', backToMenu: 'Volver al menú', payPix: 'Pagar con Pix', payCredit: 'Tarjeta de crédito', payDebit: 'Tarjeta de débito', pixDescription: 'Abre el checkout seguro de PagBank.', creditDescription: 'Paga en el entorno protegido de PagBank.', debitDescription: 'Usa el checkout alojado por PagBank.', generating: 'Generando...', service: 'Atención', callWaiter: 'Llamar al camarero', closeBill: 'Pedir la cuenta', extraGlass: 'Pedir un vaso extra', cutlery: 'Pedir cubiertos', helpToday: '¿Cómo podemos ayudarte hoy?', serviceRequest: 'Escribe tu solicitud (opcional)', servicePlaceholder: 'Ej.: Traiga 2 vasos más con hielo y limón...', sendRequest: 'Enviar solicitud', requestSent: '¡Solicitud enviada!', table: 'Mesa', viewBill: 'Ver mi cuenta', cartItems: '{{count}} {{items}} en tu pedido', accountItems: '{{count}} {{items}} en tu cuenta', noConsumptionShort: 'Aún no hay consumos', callService: 'Llamar al servicio', close: 'Cerrar', languageSettings: 'Idiomas del menú', languageSettingsDescription: 'Activa idiomas para el cliente y personaliza los textos cuando sea necesario.', active: 'Activo', inactive: 'Inactivo', publicMenu: 'Menú público', catalogTranslationHint: 'Los nombres y descripciones de los productos permanecen en português até receberem tradução própria no catálogo.',
  },
};

const normalizeCatalogText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const catalogCopy: Partial<Record<PublicLanguageCode, Record<string, string>>> = {
  'en-US': {
    'burguers beco': 'Beco burgers', 'porções': 'Sharing plates', 'pratos brasileiros': 'Brazilian dishes', 'drinks': 'Drinks', 'long necks': 'Long-neck beers', 'não alcoólicos': 'Non-alcoholic drinks', 'doses': 'Spirits',
    'bate burguer': 'Bate burger', 'batata frita queijo cremoso c/ bacon': 'Fries with creamy cheese and bacon', 'isca de frango': 'Chicken strips', 'carne acebolada': 'Onion beef strips', 'batata frita': 'French fries', 'frango a passarinho becoartes': 'Becoartes crispy chicken', 'picanha brasileira': 'Brazilian picanha steak', 'parmegiana de frango': 'Chicken parmigiana', 'parmegiana de carne': 'Beef parmigiana', 'filé de frango': 'Grilled chicken fillet', 'contra filé acebolado': 'Onion sirloin steak', 'omelete': 'Omelette', 'calabresa': 'Brazilian sausage', 'caipirinha limão': 'Lime caipirinha', 'gin tonic nacional': 'Local gin and tonic', 'gin tonic importado': 'Imported gin and tonic', 'gin tônica': 'Gin and tonic', 'água sem gás': 'Still water', 'coca-cola lata': 'Coca-Cola can', 'coca-cola zero lata': 'Coca-Cola Zero can', 'suco de manga 400ml': 'Mango juice 400 ml', 'red label whisky': 'Red Label whisky', 'vodka premium': 'Premium vodka', 'gin premium': 'Premium gin',
    'pão brioche, blend suculento, cebola caramelizada, bacon crocante e queijo derretido.': 'Brioche bun, juicy burger blend, caramelized onion, crispy bacon and melted cheese.', 'batatas fritas com cheddar cremoso e bacon crocante.': 'French fries with creamy cheddar and crispy bacon.', 'tiras de frango empanadas com tempero especial beco.': 'Breaded chicken strips with Beco’s special seasoning.', 'tiras de carne macia aceboladas na chapa.': 'Tender beef strips grilled with onions.', 'porção generosa de batatas fritas crocantes.': 'A generous serving of crispy French fries.', 'picanha premium, acompanha arroz, feijão, salada e fritas.': 'Premium picanha steak served with rice, beans, salad and fries.', 'arroz branco, batata frita, farofa da casa e salada fresca.': 'White rice, French fries, house farofa and fresh salad.', 'filé de frango grelhado, acompanha arroz, feijão, salada e fritas.': 'Grilled chicken fillet served with rice, beans, salad and fries.', 'acompanha arroz, feijão, salada e fritas crocantes.': 'Served with rice, beans, salad and crispy fries.', 'omelete recheado, acompanha arroz, feijão, salada e fritas.': 'Filled omelette served with rice, beans, salad and fries.', 'calabresa acebolada, acompanha arroz, feijão, salada e fritas.': 'Brazilian sausage with onions, served with rice, beans, salad and fries.', 'caipirinha clássica de limão com cachaça.': 'Classic lime caipirinha with cachaça.', 'gin premium, tônica e especiarias.': 'Premium gin, tonic water and spices.', 'cerveja corona gelada com limão.': 'Chilled Corona beer with lime.', 'garrafa de água mineral 500ml.': '500 ml bottle of still mineral water.', 'refrigerante coca-cola lata 350ml.': '350 ml can of Coca-Cola.', 'refrigerante 350ml sem açúcar.': '350 ml sugar-free soft drink.', 'suco gelado.': 'Chilled juice.', 'dose de whisky johnnie walker red label.': 'Shot of Johnnie Walker Red Label whisky.', 'dose de vodka de alta qualidade.': 'Shot of premium vodka.', 'dose de gin seco especial.': 'Shot of special dry gin.',
  },
  'es-ES': {
    'burguers beco': 'Hamburguesas Beco', 'porções': 'Para compartir', 'pratos brasileiros': 'Platos brasileños', 'drinks': 'Cócteles', 'long necks': 'Cervezas long neck', 'não alcoólicos': 'Bebidas sin alcohol', 'doses': 'Destilados',
    'bate burguer': 'Hamburguesa Bate', 'batata frita queijo cremoso c/ bacon': 'Papas fritas con queso cremoso y tocino', 'isca de frango': 'Tiras de pollo', 'carne acebolada': 'Tiras de carne con cebolla', 'batata frita': 'Papas fritas', 'frango a passarinho becoartes': 'Pollo crujiente Becoartes', 'picanha brasileira': 'Picanha brasileña', 'parmegiana de frango': 'Pollo a la parmesana', 'parmegiana de carne': 'Carne a la parmesana', 'filé de frango': 'Filete de pollo a la parrilla', 'contra filé acebolado': 'Lomo con cebolla', 'omelete': 'Tortilla', 'calabresa': 'Salchicha brasileña', 'caipirinha limão': 'Caipirinha de limón', 'gin tonic nacional': 'Gin tonic nacional', 'gin tonic importado': 'Gin tonic importado', 'gin tônica': 'Gin tonic', 'água sem gás': 'Agua sin gas', 'coca-cola lata': 'Lata de Coca-Cola', 'coca-cola zero lata': 'Lata de Coca-Cola Zero', 'suco de manga 400ml': 'Jugo de mango 400 ml', 'red label whisky': 'Whisky Red Label', 'vodka premium': 'Vodka premium', 'gin premium': 'Gin premium',
    'pão brioche, blend suculento, cebola caramelizada, bacon crocante e queijo derretido.': 'Pan brioche, mezcla jugosa de carne, cebolla caramelizada, tocino crujiente y queso fundido.', 'batatas fritas com cheddar cremoso e bacon crocante.': 'Papas fritas con cheddar cremoso y tocino crujiente.', 'tiras de frango empanadas com tempero especial beco.': 'Tiras de pollo empanadas con el condimento especial de Beco.', 'tiras de carne macia aceboladas na chapa.': 'Tiras tiernas de carne a la plancha con cebolla.', 'porção generosa de batatas fritas crocantes.': 'Una porción generosa de papas fritas crujientes.', 'picanha premium, acompanha arroz, feijão, salada e fritas.': 'Picanha premium con arroz, frijoles, ensalada y papas fritas.', 'arroz branco, batata frita, farofa da casa e salada fresca.': 'Arroz blanco, papas fritas, farofa de la casa y ensalada fresca.', 'filé de frango grelhado, acompanha arroz, feijão, salada e fritas.': 'Filete de pollo a la parrilla con arroz, frijoles, ensalada y papas fritas.', 'acompanha arroz, feijão, salada e fritas crocantes.': 'Acompañado de arroz, frijoles, ensalada y papas fritas crujientes.', 'omelete recheado, acompanha arroz, feijão, salada e fritas.': 'Tortilla rellena con arroz, frijoles, ensalada y papas fritas.', 'calabresa acebolada, acompanha arroz, feijão, salada e fritas.': 'Salchicha brasileña con cebolla, arroz, frijoles, ensalada y papas fritas.', 'caipirinha clássica de limão com cachaça.': 'Caipirinha clásica de limón con cachaça.', 'gin premium, tônica e especiarias.': 'Gin premium, tónica y especias.', 'cerveja corona gelada com limão.': 'Cerveza Corona fría con limón.', 'garrafa de água mineral 500ml.': 'Botella de agua mineral sin gas de 500 ml.', 'refrigerante coca-cola lata 350ml.': 'Lata de Coca-Cola de 350 ml.', 'refrigerante 350ml sem açúcar.': 'Refresco sin azúcar de 350 ml.', 'suco gelado.': 'Jugo frío.', 'dose de whisky johnnie walker red label.': 'Copa de whisky Johnnie Walker Red Label.', 'dose de vodka de alta qualidade.': 'Copa de vodka premium.', 'dose de gin seco especial.': 'Copa de gin seco especial.',
  },
};

Object.assign(catalogCopy['en-US']!, {
  'pratos para 2': 'Dishes for two',
  'parmegiana de frango para 2 (batata inclusa)': 'Chicken parmigiana for two (fries included)',
  'parmegiana de carne para 2 (batata inclusa)': 'Beef parmigiana for two (fries included)',
  'filé de frango para 2 (batata inclusa)': 'Grilled chicken fillet for two (fries included)',
  'contra filé acebolado para 2 (batata inclusa)': 'Onion sirloin steak for two (fries included)',
  'calabresa para 2 (batata inclusa)': 'Brazilian sausage for two (fries included)',
  'omelete para 2 (batata inclusa)': 'Omelette for two (fries included)',
  'feito para dividir: duas porções de parmegiana de frango, arroz branco, farofa da casa, salada fresca e batata frita inclusa.': 'Made for sharing: two servings of chicken parmigiana with white rice, house farofa, fresh salad and fries.',
  'feito para dividir: duas porções de parmegiana de carne, arroz branco, farofa da casa, salada fresca e batata frita inclusa.': 'Made for sharing: two servings of beef parmigiana with white rice, house farofa, fresh salad and fries.',
  'feito para dividir: duas porções de filé de frango grelhado, arroz, feijão, salada e batata frita inclusa.': 'Made for sharing: two servings of grilled chicken fillet with rice, beans, salad and fries.',
  'feito para dividir: duas porções de contra filé acebolado, arroz, feijão, salada e batata frita inclusa.': 'Made for sharing: two servings of onion sirloin steak with rice, beans, salad and fries.',
  'feito para dividir: duas porções de calabresa acebolada, arroz, feijão, salada e batata frita inclusa.': 'Made for sharing: two servings of Brazilian sausage with onions, rice, beans, salad and fries.',
  'feito para dividir: duas porções de omelete recheado, arroz, feijão, salada e batata frita inclusa.': 'Made for sharing: two servings of filled omelette with rice, beans, salad and fries.',
});

Object.assign(catalogCopy['es-ES']!, {
  'pratos para 2': 'Platos para dos',
  'parmegiana de frango para 2 (batata inclusa)': 'Pollo a la parmesana para dos (papas incluidas)',
  'parmegiana de carne para 2 (batata inclusa)': 'Carne a la parmesana para dos (papas incluidas)',
  'filé de frango para 2 (batata inclusa)': 'Filete de pollo para dos (papas incluidas)',
  'contra filé acebolado para 2 (batata inclusa)': 'Lomo con cebolla para dos (papas incluidas)',
  'calabresa para 2 (batata inclusa)': 'Salchicha brasileña para dos (papas incluidas)',
  'omelete para 2 (batata inclusa)': 'Tortilla para dos (papas incluidas)',
  'feito para dividir: duas porções de parmegiana de frango, arroz branco, farofa da casa, salada fresca e batata frita inclusa.': 'Para compartir: dos porciones de pollo a la parmesana con arroz blanco, farofa de la casa, ensalada fresca y papas fritas.',
  'feito para dividir: duas porções de parmegiana de carne, arroz branco, farofa da casa, salada fresca e batata frita inclusa.': 'Para compartir: dos porciones de carne a la parmesana con arroz blanco, farofa de la casa, ensalada fresca y papas fritas.',
  'feito para dividir: duas porções de filé de frango grelhado, arroz, feijão, salada e batata frita inclusa.': 'Para compartir: dos porciones de filete de pollo a la parrilla con arroz, frijoles, ensalada y papas fritas.',
  'feito para dividir: duas porções de contra filé acebolado, arroz, feijão, salada e batata frita inclusa.': 'Para compartir: dos porciones de lomo con cebolla, arroz, frijoles, ensalada y papas fritas.',
  'feito para dividir: duas porções de calabresa acebolada, arroz, feijão, salada e batata frita inclusa.': 'Para compartir: dos porciones de salchicha brasileña con cebolla, arroz, frijoles, ensalada y papas fritas.',
  'feito para dividir: duas porções de omelete recheado, arroz, feijão, salada e batata frita inclusa.': 'Para compartir: dos porciones de tortilla rellena con arroz, frijoles, ensalada y papas fritas.',
});

const getCatalogBaseTranslation = (locale: PublicLanguageCode, text: string) => {
  const normalizedText = normalizeCatalogText(text);
  return Object.entries(catalogCopy[locale] || {}).find(([source]) => normalizeCatalogText(source) === normalizedText)?.[1];
};

export const getDefaultPublicCopy = (locale: PublicLanguageCode) => ({ ...(copy[locale as keyof typeof copy] || copy['pt-BR']) });

const STORAGE_KEY = 'beco_public_language';

const interpolate = (value: string, values: Record<string, string | number>) => value.replace(/{{(\w+)}}/g, (_, key) => String(values[key] ?? ''));

export const getPublicLanguages = (settings?: AppSettings): PublicLanguageConfig[] => {
  const configured = settings?.publicLanguages || [];
  return defaultPublicLanguages.map((fallback) => ({
    ...fallback,
    ...(configured.find((language) => language.code === fallback.code) || {}),
  }));
};

type I18nState = {
  locale: PublicLanguageCode;
  languages: PublicLanguageConfig[];
  setLocale: (locale: PublicLanguageCode) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  catalogText: (id: string, text: string, field: 'name' | 'description') => string;
};

const PublicI18nContext = createContext<I18nState | null>(null);

export function PublicI18nProvider({ settings, children }: { settings: AppSettings; children: ReactNode }) {
  const languages = useMemo(() => getPublicLanguages(settings), [settings]);
  const [locale, setLocaleState] = useState<PublicLanguageCode>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as PublicLanguageCode | null;
    return stored || 'pt-BR';
  });

  useEffect(() => {
    if (languages.some((language) => language.code === locale && language.enabled)) return;
    setLocaleState('pt-BR');
  }, [languages, locale]);

  const setLocale = useCallback((nextLocale: PublicLanguageCode) => {
    if (!languages.some((language) => language.code === nextLocale && language.enabled)) return;
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  }, [languages]);

  const value = useMemo<I18nState>(() => ({
    locale,
    languages,
    setLocale,
    t: (key, values = {}) => {
      const language = languages.find((item) => item.code === locale);
      const raw = language?.copy?.[key] || copy[locale as keyof typeof copy]?.[key] || copy['pt-BR'][key] || key;
      return interpolate(raw, values);
    },
    catalogText: (id, text, field) => languages.find((item) => item.code === locale)?.catalog?.[id]?.[field] || getCatalogBaseTranslation(locale, text) || text,
  }), [languages, locale, setLocale]);

  return <PublicI18nContext.Provider value={value}>{children}</PublicI18nContext.Provider>;
}

export function usePublicI18n() {
  const context = useContext(PublicI18nContext);
  if (!context) throw new Error('usePublicI18n deve ser usado dentro de PublicI18nProvider');
  return context;
}
