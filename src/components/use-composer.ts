'use client';
import { readInterfacePreference, writeInterfacePreference } from '@/lib/client-preferences';
import { useEffect, useState } from 'react';
import { composerPreferencesKey, freshComposer, writeComposerPreferences } from '@/lib/composer-preferences';

export function useComposer() {
  const [request,setRequest]=useState(()=>freshComposer());
  const [restored,setRestored]=useState(false),[storageError,setStorageError]=useState('');
  useEffect(()=>{
    try{setRequest(freshComposer(readInterfacePreference(composerPreferencesKey)));}
    catch{setStorageError('Local preferences are unavailable. These settings will last only until you close Frok.');}
    try{sessionStorage.removeItem('frok-last');sessionStorage.removeItem('frok-session-jobs');}catch{}
    setRestored(true);
  },[]);
  const preferences=writeComposerPreferences(request);
  useEffect(()=>{
    // State, rather than a ref set by the preceding effect, prevents the first
    // render (and Strict Mode replay) from overwriting storage with defaults.
    if(!restored)return;
    let closed=false;
    void writeInterfacePreference(composerPreferencesKey,preferences).then(()=>{if(!closed)setStorageError('');}).catch(()=>{if(!closed)setStorageError('Could not save your settings. These choices will last only until you close Frok.');});
    return()=>{closed=true;};
  },[preferences,restored]);
  return {request,setRequest,storageError};
}
