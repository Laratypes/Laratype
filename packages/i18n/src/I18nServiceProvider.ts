import { ServiceProvider } from '@laratype/support'
import { Translator } from './Translator'
import { loadMessages } from './catalog'
import { Locale } from './Locale'

/**
 * Loads `appManifest().lang` (`lang/<locale>/<file>.ts`) at boot and binds the `Translator` the `Lang` facade and
 * `trans()` / `__()` use (I1 #167). Add it to `app/config/providers.ts`.
 */
export class I18nServiceProvider extends ServiceProvider {

  public async register(): Promise<void> {
    const catalog = await loadMessages()
    this.app.scoped(Locale)
    this.app.instance(Translator, new Translator(catalog))
  }

}
