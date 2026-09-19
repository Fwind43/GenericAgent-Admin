import { useEffect } from 'react'
import { refreshRuntimeModels } from './runtimeModelRefresh.js'

// Saving providers in Admin dispatches this on the settings page, which lives in
// the same document as the chat composer.
export const MODELS_CHANGE_EVENT = 'ga-admin-models-change'

export function useRuntimeModelRefresh({ sidRef, fetchState, setLlms, setLlmNo }) {
  useEffect(() => {
    const onModelsChange = () => {
      void refreshRuntimeModels({ sid: sidRef?.current || '', fetchState, setLlms, setLlmNo })
    }
    window.addEventListener(MODELS_CHANGE_EVENT, onModelsChange)
    return () => window.removeEventListener(MODELS_CHANGE_EVENT, onModelsChange)
  }, [sidRef, fetchState, setLlms, setLlmNo])
}
