const epochKey='frok-library-reset';
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(event.key===epochKey&&event.oldValue!==null&&event.newValue!==event.oldValue)window.location.replace('/');
});
export function resetBrowserStorage(){
  if(typeof window==='undefined')return;
  for(const name of ['localStorage','sessionStorage'] as const)try{
    const storage=window[name];for(const key of Object.keys(storage))if(key.startsWith('frok')||key==='userPrompts')storage.removeItem(key);
  }catch{/* Storage can be disabled by browser preferences. */}
}
export async function api<T=Record<string,unknown>>(url:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(`/api/${url}`,{method,credentials:'same-origin',cache:'no-store',headers:{'X-Frok-Request':'1',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Request failed');
  if(typeof window!=='undefined'){
    const epoch=response.headers.get('X-Frok-Reset');
    try {
      // Retire browser identity while preserving recipes on the initial upgrade.
      localStorage.removeItem('frok-browser-identity');
      const previous=localStorage.getItem(epochKey);
      if(epoch&&previous&&previous!==epoch){resetBrowserStorage();localStorage.setItem(epochKey,epoch);window.location.replace('/');throw Error('The library was reset. Reopening the studio…');}
      if(epoch)localStorage.setItem(epochKey,epoch);
    }catch(error){if(error instanceof Error&&error.message.startsWith('The library was reset'))throw error;}
  }
  if(url==='library'&&method==='DELETE')resetBrowserStorage();
  return result;
}
