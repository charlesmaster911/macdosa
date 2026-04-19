// 국가별 검색 채널 — AI 프롬프트에 주입
export const CHANNELS = {
  KR: {
    currency: 'KRW',
    new: ['다나와', '쿠팡', '롯데하이마트', '11번가', '네이버쇼핑'],
    used: ['맥뮤지엄', '당근마켓', '번개장터', '중고나라'],
    card_query: '삼성카드 현대카드 신한카드 KB국민카드 즉시할인',
    refurb: 'apple.com/kr/shop/refurbished',
    education: 'apple.com/kr/shop/go/product/education'
  },
  US: {
    currency: 'USD',
    new: ['B&H Photo', 'Best Buy', 'Amazon', 'Costco', 'Apple Store'],
    used: ['Swappa', 'eBay', 'Facebook Marketplace', 'Back Market'],
    card_query: 'Apple Card cashback Chase Sapphire credit card discount',
    refurb: 'apple.com/shop/refurbished',
    education: 'apple.com/us-hed/shop'
  },
  JP: {
    currency: 'JPY',
    new: ['Amazon Japan', 'Yodobashi', 'Bic Camera', 'Sofmap', 'Apple Store'],
    used: ['Mercari', 'Yahoo Auction', 'Janpara', 'Sofmap Used'],
    card_query: 'クレジットカード 即時割引 ポイント還元',
    refurb: 'apple.com/jp/shop/refurbished',
    education: 'apple.com/jp/shop/go/product/education'
  }
};

export function getCountryFromRequest(req) {
  const lang = req.headers['accept-language'] || '';
  if (lang.startsWith('ja')) return 'JP';
  if (lang.startsWith('en')) return 'US';
  return 'KR'; // default
}
