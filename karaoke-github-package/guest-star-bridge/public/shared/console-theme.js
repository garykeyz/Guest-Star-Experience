import {brandingTheme} from './branding-theme.js';
import {normalizeBrandImageUrl} from './brand-image-url.js';
// Existing Guest Star palette from superhost-branding.css; never stored as hotel data.
export const BASE_BRAND=Object.freeze({primaryColor:'#ff2d95',secondaryColor:'#8b3dff',accentColor:'#00c8ff'});
export function safeLogo(value) {
 const source=normalizeBrandImageUrl(value);
 if(/^\/branding\/[\w./-]+$/.test(source))return source;
 try {const url=new URL(source);return url.protocol==='https:'?url.href:'';}catch{return '';}
}
export function consoleTheme(brand={}) {
 const valid=key=>/^#[\da-f]{6}$/i.test(String(brand[key] || '').trim())?String(brand[key]).trim():BASE_BRAND[key];
 return brandingTheme({...BASE_BRAND,...Object.fromEntries(Object.keys(BASE_BRAND).map(k=>[k,valid(k)]))});
}
export function createConsoleThemeCache() {
 let owner='',cache=new Map();
 return {
  resolve(state,hotelId,readAuthorizedBrand=()=>({})) {
   const id=state?.account?.authenticated ? state.account.user?.userId || state.account.user?.id || '' : '';
   if(!state?.account?.authenticated || owner!==id){cache.clear();owner=id;}
   if(!state?.account?.authenticated || !(state.account.selection?.hotels || []).some(h=>h.hotelId===hotelId))return {};
   let brand=state.tenant?.hotel?.hotelId===hotelId && state.account.current?.hotelId===hotelId ? state.tenant.branding : null;
   if(!brand && state.account.user?.role==='superhost')brand=readAuthorizedBrand(hotelId);
   if(brand && Object.keys(brand).length && (!brand.hotelId || brand.hotelId===hotelId)){cache.set(hotelId,{...brand});}
   return {...(cache.get(hotelId) || {})};
  },
  apply(element,brand={}){for(const [key,value] of Object.entries(consoleTheme(brand)))element.style.setProperty(key,value);}
 };
}
