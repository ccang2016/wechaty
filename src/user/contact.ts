/**
 *   Wechaty - https://github.com/chatie/wechaty
 *
 *   @copyright 2016-2018 Huan LI <zixia@zixia.net>
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 *   @ignore
 */
import { FileBox } from 'file-box'
import { instanceToClass } from 'clone-class'

import {
  log,
  Raven,
  Sayable,
}             from '../config'
import {
  Accessory,
}             from '../accessory'

// import Message          from './message'

import {
  ContactGender,
  ContactPayload,
  ContactQueryFilter,
  ContactType,
}                         from 'wechaty-puppet'

export const POOL = Symbol('pool')

/**
 * All wechat contacts(friend) will be encapsulated as a Contact.
 *
 * `Contact` is `Sayable`,
 * [Examples/Contact-Bot]{@link https://github.com/Chatie/wechaty/blob/master/examples/contact-bot.ts}
 */
export class Contact extends Accessory implements Sayable {

  // tslint:disable-next-line:variable-name
  public static Type   = ContactType
  // tslint:disable-next-line:variable-name
  public static Gender = ContactGender

  protected static [POOL]: Map<string, Contact>
  protected static get pool() {
    return this[POOL]
  }
  protected static set pool(newPool: Map<string, Contact>) {
    if (this === Contact) {
      throw new Error(
        'The global Contact class can not be used directly!'
        + 'See: https://github.com/Chatie/wechaty/issues/1217',
      )
    }
    this[POOL] = newPool
  }

  /**
   * @private
   * About the Generic: https://stackoverflow.com/q/43003970/1123955
   */
  public static load<T extends typeof Contact>(
    this : T,
    id   : string,
  ): T['prototype'] {
    if (!this.pool) {
      log.verbose('Contact', 'load(%s) init pool', id)
      this.pool = new Map<string, Contact>()
    }
    if (this === Contact) {
      throw new Error(
        'The lgobal Contact class can not be used directly!'
        + 'See: https://github.com/Chatie/wechaty/issues/1217',
      )
    }
    if (this.pool === Contact.pool) {
      throw new Error('the current pool is equal to the global pool error!')
    }
    const existingContact = this.pool.get(id)
    if (existingContact) {
      return existingContact
    }

    // when we call `load()`, `this` should already be extend-ed a child class.
    // so we force `this as any` at here to make the call.
    const newContact = new (this as any)(id) as Contact
    // newContact.payload = this.puppet.cacheContactPayload.get(id)

    this.pool.set(id, newContact)

    return newContact
  }

  /**
   * The way to search Contact
   *
   * @typedef    ContactQueryFilter
   * @property   {string} name    - The name-string set by user-self, should be called name
   * @property   {string} alias   - The name-string set by bot for others, should be called alias
   * [More Detail]{@link https://github.com/Chatie/wechaty/issues/365}
   */

  /**
   * Try to find a contact by filter: {name: string | RegExp} / {alias: string | RegExp}
   *
   * Find contact by name or alias, if the result more than one, return the first one.
   *
   * @static
   * @param {ContactQueryFilter} query
   * @returns {(Promise<Contact | null>)} If can find the contact, return Contact, or return null
   * @example
   * const contactFindByName = await Contact.find({ name:"ruirui"} )
   * const contactFindByAlias = await Contact.find({ alias:"lijiarui"} )
   */
  public static async find<T extends typeof Contact>(
    this  : T,
    query : string | ContactQueryFilter,
  ): Promise<T['prototype'] | null> {
    log.verbose('Contact', 'find(%s)', JSON.stringify(query))

    const contactList = await this.findAll(query)

    if (!contactList) {
      return null
    }
    if (contactList.length < 1) {
      return null
    }

    if (contactList.length > 1) {
      log.warn('Contact', 'find() got more than one(%d) result', contactList.length)
    }

    let n = 0
    for (n = 0; n < contactList.length; n++) {
      const contact = contactList[n]
      // use puppet.contactValidate() to confirm double confirm that this contactId is valid.
      // https://github.com/lijiarui/wechaty-puppet-padchat/issues/64
      // https://github.com/Chatie/wechaty/issues/1345
      const valid = await this.puppet.contactValidate(contact.id)
      if (valid) {
        log.verbose('Contact', 'find() confirm contact[#%d] with id=%d is vlaid result, return it.',
                            n,
                            contact.id,
                  )
        return contact
      } else {
        log.verbose('Contact', 'find() confirm contact[#%d] with id=%d is INVALID result, try next',
                            n,
                            contact.id,
                    )
      }
    }
    log.warn('Contact', 'find() got %d contacts but no one is valid.', contactList.length)
    return null
  }

  /**
   * Find contact by `name` or `alias`
   *
   * If use Contact.findAll() get the contact list of the bot.
   *
   * #### definition
   * - `name`   the name-string set by user-self, should be called name
   * - `alias`  the name-string set by bot for others, should be called alias
   *
   * @static
   * @param {ContactQueryFilter} [queryArg]
   * @returns {Promise<Contact[]>}
   * @example
   * const contactList = await Contact.findAll()                    // get the contact list of the bot
   * const contactList = await Contact.findAll({name: 'ruirui'})    // find allof the contacts whose name is 'ruirui'
   * const contactList = await Contact.findAll({alias: 'lijiarui'}) // find all of the contacts whose alias is 'lijiarui'
   */
  public static async findAll<T extends typeof Contact>(
    this  : T,
    query? : string | ContactQueryFilter,
  ): Promise<T['prototype'][]> {
    log.verbose('Contact', 'findAll(%s)', JSON.stringify(query))

    if (query && Object.keys(query).length !== 1) {
      throw new Error('query only support one key. multi key support is not availble now.')
    }

    try {
      const contactIdList: string[] = await this.puppet.contactSearch(query)
      const contactList = contactIdList.map(id => this.load(id))

      await Promise.all(contactList.map(c => c.ready()))
      return contactList

    } catch (e) {
      log.error('Contact', 'this.puppet.contactFindAll() rejected: %s', e.message)
      return [] // fail safe
    }
  }

  // TODO
  public static async delete(contact: Contact): Promise<void> {
    log.verbose('Contact', 'static delete(%s)', contact.id)
  }

  /**
   *
   * Instance properties
   *
   */
  protected get payload(): undefined | ContactPayload {
    if (!this.id) {
      return undefined
    }
    return this.puppet.contactPayloadCache(this.id)
  }

  /**
   * @private
   */
  constructor(
    public readonly id: string,
  ) {
    super()
    log.silly('Contact', `constructor(${id})`)

    // tslint:disable-next-line:variable-name
    const MyClass = instanceToClass(this, Contact)

    if (MyClass === Contact) {
      throw new Error(
        'Contact class can not be instanciated directly!'
        + 'See: https://github.com/Chatie/wechaty/issues/1217',
      )
    }

    if (!this.puppet) {
      throw new Error('Contact class can not be instanciated without a puppet!')
    }
  }

  /**
   * @private
   */
  public toString(): string {
    if (!this.payload) {
      return this.constructor.name
    }
    const identity = this.payload.alias || this.payload.name || this.id
    return `Contact<${identity || 'Unknown'}>`
  }

  /**
   * Sent Text to contact
   *
   * @param {string} text
   * @example
   * const contact = await Contact.find({name: 'lijiarui'})         // change 'lijiarui' to any of your contact name in wechat
   * try {
   *   await contact.say('welcome to wechaty!')
   * } catch (e) {
   *   console.error(e)
   * }
   */
  public async say(text: string): Promise<void>

  /**
   * Send Media File to Contact
   *
   * @param {Message} Message
   * @example
   * const contact = await Contact.find({name: 'lijiarui'})         // change 'lijiarui' to any of your contact name in wechat
   * try {
   *   await contact.say(bot.Message.create(__dirname + '/wechaty.png') // put the filePath you want to send here
   * } catch (e) {
   *   console.error(e)
   * }
   */
  public async say(file: FileBox)    : Promise<void>
  public async say(contact: Contact) : Promise<void>

  public async say(textOrContactOrFile: string | Contact | FileBox): Promise<void> {
    log.verbose('Contact', 'say(%s)', textOrContactOrFile)

    if (typeof textOrContactOrFile === 'string') {
      /**
       * 1. Text
       */
      await this.puppet.messageSendText({
        contactId: this.id,
      }, textOrContactOrFile)
    } else if (textOrContactOrFile instanceof Contact) {
      /**
       * 2. Contact
       */
      await this.puppet.messageSendContact({
        contactId: this.id,
      }, textOrContactOrFile.id)
    } else if (textOrContactOrFile instanceof FileBox) {
      /**
       * 3. File
       */
      await this.puppet.messageSendFile({
        contactId: this.id,
      }, textOrContactOrFile)
    } else {
      throw new Error('unsupported')
    }
  }

  /**
   * Get the name from a contact
   *
   * @returns {string}
   * @example
   * const name = contact.name()
   */
  public name(): string {
    return this.payload && this.payload.name || ''
  }

  public alias()                  : null | string
  public alias(newAlias:  string) : Promise<void>
  public alias(empty:     null)   : Promise<void>

  /**
   * GET / SET / DELETE the alias for a contact
   *
   * Tests show it will failed if set alias too frequently(60 times in one minute).
   * @param {(none | string | null)} newAlias
   * @returns {(string | null | Promise<boolean>)}
   * @example <caption> GET the alias for a contact, return {(string | null)}</caption>
   * const alias = contact.alias()
   * if (alias === null) {
   *   console.log('You have not yet set any alias for contact ' + contact.name())
   * } else {
   *   console.log('You have already set an alias for contact ' + contact.name() + ':' + alias)
   * }
   *
   * @example <caption>SET the alias for a contact</caption>
   * try {
   *   await contact.alias('lijiarui')
   *   console.log(`change ${contact.name()}'s alias successfully!`)
   * } catch (e) {
   *   console.log(`failed to change ${contact.name()} alias!`)
   * }
   *
   * @example <caption>DELETE the alias for a contact</caption>
   * try {
   *   const oldAlias = await contact.alias(null)
   *   console.log(`delete ${contact.name()}'s alias successfully!`)
   *   console.log('old alias is ${oldAlias}`)
   * } catch (e) {
   *   console.log(`failed to delete ${contact.name()}'s alias!`)
   * }
   */
  public alias(newAlias?: null | string): null | string | Promise<void> {
    log.silly('Contact', 'alias(%s)',
                            newAlias === undefined
                              ? ''
                              : newAlias,
                )

    if (!this.payload) {
      throw new Error('no payload')
    }

    if (typeof newAlias === 'undefined') {
      return this.payload && this.payload.alias || null
    }

    const future = this.puppet.contactAlias(this.id, newAlias)

    future
      .then(() => this.payload!.alias = (newAlias || undefined))
      .catch(e => {
        log.error('Contact', 'alias(%s) rejected: %s', newAlias, e.message)
        Raven.captureException(e)
      })

    return future
  }

  /**
   * Check if contact is stranger
   *
   * @deprecated use friend() instead
   *
   * @returns {boolean | null} - True for not friend of the bot, False for friend of the bot, null for unknown.
   * @example
   * const isStranger = contact.stranger()
   */
  public stranger(): null | boolean {
    log.warn('Contact', 'stranger() DEPRECATED. use friend() instead.')
    if (!this.payload) return null
    return !this.friend()
  }

  /**
   * Check if contact is friend
   *
   * @returns {boolean | null} - True for friend of the bot, False for not friend of the bot, null for unknown.
   * @example
   * const isFriend = contact.friend()
   */
  public friend(): null | boolean {
    log.verbose('Contact', 'friend()')
    if (!this.payload) {
      return null
    }
    return this.payload.friend || null
  }

  /**
   * Check if it's a offical account
   *
   * @deprecated use type() instead
   *
   * @returns {boolean | null} - True for official account, Flase for contact is not a official account, null for unknown
   * @see {@link https://github.com/Chatie/webwx-app-tracker/blob/7c59d35c6ea0cff38426a4c5c912a086c4c512b2/formatted/webwxApp.js#L3243|webwxApp.js#L324}
   * @see {@link https://github.com/Urinx/WeixinBot/blob/master/README.md|Urinx/WeixinBot/README}
   * @example
   * const isOfficial = contact.official()
   */
  public official(): boolean {
    log.warn('Contact', 'official() DEPRECATED. use type() instead')
    return !!this.payload && this.payload.type === ContactType.Official
  }

  /**
   * Check if it's a personal account
   *
   * @deprecated use type() instead
   *
   * @returns {boolean} - True for personal account, Flase for contact is not a personal account
   * @example
   * const isPersonal = contact.personal()
   */
  public personal(): boolean {
    log.warn('Contact', 'personal() DEPRECATED. use type() instead')
    return !this.official()
  }

  /**
   * Return the type of the Contact
   *
   * @returns ContactType - Contact.Type.PERSONAL for personal account, Contact.Type.OFFICIAL for official account
   * @example
   * const isOfficial = contact.type() === Contact.Type.OFFICIAL
   */
  public type(): ContactType {
    return this.payload!.type
  }

  /**
   * Check if the contact is star contact.
   *
   * @returns {boolean | null} - True for star friend, False for no star friend.
   * @example
   * const isStar = contact.star()
   */
  public star(): null | boolean {
    if (!this.payload) {
      return null
    }
    return this.payload.star === undefined
      ? null
      : this.payload.star
  }

  /**
   * Contact gender
   *
   * @returns {ContactGender.Male(2)|Gender.Female(1)|Gender.Unknown(0)}
   * @example
   * const gender = contact.gender()
   */
  public gender(): ContactGender {
    return this.payload
      ? this.payload.gender
      : ContactGender.Unknown
  }

  /**
   * Get the region 'province' from a contact
   *
   * @returns {string | null}
   * @example
   * const province = contact.province()
   */
  public province(): null | string {
    return this.payload && this.payload.province || null
  }

  /**
   * Get the region 'city' from a contact
   *
   * @returns {string | null}
   * @example
   * const city = contact.city()
   */
  public city(): null | string {
    return this.payload && this.payload.city || null
  }

  /**
   * Get avatar picture file stream
   *
   * @returns {Promise<FileBox>}
   * @example
   * const avatarFileName = contact.name() + `.jpg`
   * const fileBox = await contact.avatar()
   * const avatarWriteStream = createWriteStream(avatarFileName)
   * fileBox.pipe(avatarWriteStream)
   * log.info('Bot', 'Contact: %s: %s with avatar file: %s', contact.weixin(), contact.name(), avatarFileName)
   */
  // TODO: use File to replace ReadableStream
  public async avatar(): Promise<FileBox> {
    log.verbose('Contact', 'avatar()')

    return this.puppet.contactAvatar(this.id)
  }

  /**
   * Force reload(re-ready()) data for Contact
   *
   * @deprecated use sync() instead
   *
   * @returns {Promise<this>}
   * @example
   * await contact.refresh()
   */
  public refresh(): Promise<void> {
    log.warn('Contact', 'refresh() DEPRECATED. use sync() instead.')
    return this.sync()
  }

  /**
   * sycc data for Contact
   *
   * @returns {Promise<this>}
   * @example
   * await contact.sync()
   */
  public async sync(): Promise<void> {
    await this.ready(true)
  }

  /**
   * @private
   */
  public async ready(dirty = false): Promise<void> {
    log.silly('Contact', 'ready() @ %s', this.puppet)

    if (this.isReady()) { // already ready
      log.silly('Contact', 'ready() isReady() true')
      return
    }

    try {
      if (dirty) {
        await this.puppet.contactPayloadDirty(this.id)
      }
      await this.puppet.contactPayload(this.id)
      // log.silly('Contact', `ready() this.puppet.contactPayload(%s) resolved`, this)

    } catch (e) {
      log.error('Contact', `ready() this.puppet.contactPayload(%s) exception: %s`,
                            this,
                            e.message,
                )
      Raven.captureException(e)
      throw e
    }
  }

  /**
   * @private
   */
  public isReady(): boolean {
    return !!(this.payload && this.payload.name)
  }

  /**
   * Check if contact is self
   *
   * @returns {boolean} True for contact is self, False for contact is others
   * @example
   * const isSelf = contact.self()
   */
  public self(): boolean {
    const userId = this.puppet.selfId()

    if (!userId) {
      return false
    }

    return this.id === userId
  }

  /**
   * Get the weixin number from a contact.
   *
   * Sometimes cannot get weixin number due to weixin security mechanism, not recommend.
   *
   * @private
   * @returns {string | null}
   * @example
   * const weixin = contact.weixin()
   */
  public weixin(): null | string {
    return this.payload && this.payload.weixin || null
  }
}

export class ContactSelf extends Contact {
  constructor(
    id: string,
  ) {
    super(id)
  }

  public async avatar()              : Promise<FileBox>
  public async avatar(file: FileBox) : Promise<void>

  public async avatar(file?: FileBox): Promise<void | FileBox> {
    log.verbose('Contact', 'avatar(%s)', file ? file.name : '')

    if (!file) {
      return await super.avatar()
    }

    if (this.id !== this.puppet.selfId()) {
      throw new Error('set avatar only available for user self')
    }

    await this.puppet.contactAvatar(this.id, file)
  }

  public async qrcode(): Promise<string> {
    log.verbose('Contact', 'qrcode()')

    if (this.id !== this.puppet.selfId()) {
      throw new Error('only can get qrcode for the login userself')
    }

    return await this.puppet.contactQrcode(this.id)
  }

}

export default Contact
