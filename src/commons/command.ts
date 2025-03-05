import { ApplicationCommandOptionData, ApplicationCommandOptionType, ApplicationIntegrationType, AutocompleteInteraction, BaseApplicationCommandData, CacheType, ChatInputApplicationCommandData, Client, CommandInteraction, CommandInteractionOptionResolver, Guild, GuildMember, InteractionContextType, InteractionReplyOptions, InteractionEditReplyOptions, InteractionResponse, Message, MessageApplicationCommandData, MessageContextMenuCommandInteraction, MessageCreateOptions, MessagePayload, TextBasedChannel, User, UserApplicationCommandData, UserContextMenuCommandInteraction, InteractionDeferReplyOptions } from "discord.js";
import { prefix } from "..";
import { logger } from "../events/errorDebugger";

export enum ShoukoCommandCategory {
  General = "General",
  Shouko = "Shouko",
  Misc = "Misc",
  Acts = "Actions"
}

export interface ShoukoCommand extends BaseApplicationCommandData {
  category?: ShoukoCommandCategory,
  notHybrid?: boolean
}

type CommandOptionValue =
  | string
  | number
  | boolean
  | User
  | Promise<User>
  | GuildMember
  | Promise<GuildMember>
  | null

export class ShoukoHybridCommand {
  client: Client;
  context: Message | CommandInteraction | UserContextMenuCommandInteraction;
  options?: CommandInteractionOptionResolver<CacheType> | ParsedOptions;
  guild: Guild | null
  user: User
  commandName: string
  message: Message<boolean> | null
  id: string
  targetMember?: GuildMember
  targetUser?: User
  targetId?: string

  constructor (client: Client, context: Message | CommandInteraction | UserContextMenuCommandInteraction, _options: Array<ApplicationCommandOptionData>) {
    this.client = client;
    this.context = context;
    this.user = this.getUser();
    this.guild = this.getGuild();
    this.message = null;
    this.id = this.context.id

    if (this.isInteraction(context)) {
      this.options = context.options as CommandInteractionOptionResolver<CacheType>;
      this.commandName = (this.context as CommandInteraction).commandName
    } else if (this.isUserContext(context)) { 
      this.commandName = (this.context as UserContextMenuCommandInteraction).commandName
      this.targetUser = (this.context as UserContextMenuCommandInteraction).targetUser as User | undefined
      this.targetMember = (this.context as UserContextMenuCommandInteraction).targetMember as GuildMember | undefined
      this.targetId = this.targetId = (this.context as UserContextMenuCommandInteraction).targetId
    } else {
      this.commandName = parseRawArgs(context.content.trim().toLowerCase().slice(prefix.length))[0]
      const args = parseMessageArgs(client, parseRawArgs(context.content.trim()).slice(1), _options as ApplicationCommandOptionData[]);
      this.options = args
      if (process.env.DEBUG_MODE) logger(`HybridCommandArgs [${this.commandName} (${this.user.username})]: ` + JSON.stringify(args))
    }
  }

  inGuild(): boolean {
    return this.context.guild != null
  }

  getUser(): User {
    if ('author' in this.context) {
      return this.context.author;
    } else {
      return this.context.user;
    }
  }

  getChannel(): TextBasedChannel | null {
    return this.context.channel;
  }

  getGuild(): Guild | null {
    return this.context.guild
  }

  getMember(): GuildMember | null {
    if ('member' in this.context) {
      return this.context.member! as GuildMember;
    }
    return null;
  }

  isUserContextMenu(): boolean {
    return this.isUserContext(this.context)
  }

  isMessageBased(): boolean {
    return this.isMessage(this.context)
  }

  isChatInput(): boolean {
    return this.isInteraction(this.context)
  }

  // Type guard to check if context is a Message
  private isMessage(context: Message | CommandInteraction): context is Message {
    return (context as Message).author !== undefined;
  }

  // Type guard for interaction
  private isInteraction(context: CommandInteraction | Message | UserContextMenuCommandInteraction): context is CommandInteraction<CacheType> {
    return 'options' in context;
  }

  // Type guard for usercontextinteraction
  private isUserContext(context: CommandInteraction | Message | UserContextMenuCommandInteraction): context is UserContextMenuCommandInteraction<CacheType> {
    return 'targetUser' in context;
  }

  getOption<T extends CommandOptionValue>(name: string): T | null {
    if (this.isInteraction(this.context)) {
      const option = this?.options != null ? (this.options as CommandInteractionOptionResolver<CacheType>).get(name) : null;
      if (!option) return null;
      
      // Type checking based on ApplicationCommandOptionType
      switch (option.type) {
        case ApplicationCommandOptionType.User:
          return option.user as T;
        case ApplicationCommandOptionType.Boolean:
          return option.value as T; // boolean
        case ApplicationCommandOptionType.String:
          return option.value as T; // string
        case ApplicationCommandOptionType.Channel:
          return option.channel as T;
        case ApplicationCommandOptionType.Subcommand:
          return option.name as T;
        default:
          return null;
      }
    } else {
      // Handle message-based command option retrieval (map args to options manually)
      const value = (this.options as any)[name];  // Handle string-indexing safely
      if (value === undefined || value === null) return null;
      return value as T;
    }
  }

  // Method to reply (handles both Message and Interaction)
  async reply(content: MessagePayload | InteractionReplyOptions) {
    if (this.isInteraction(this.context)) {
      if (!this.context.isRepliable()) throw new Error("Interaction has already been replied.");
      await this.context.reply(content as InteractionReplyOptions);
    } else if (this.isMessage(this.context)) {
      (content as MessageCreateOptions).allowedMentions = { repliedUser: false }
      this.message = await this.context.reply(content as MessageCreateOptions)
    } else {
      throw new Error('Cannot reply to the command context');
    }
  }

  async followUp(content: MessageCreateOptions | MessagePayload | InteractionReplyOptions): Promise<InteractionResponse<boolean> | Message<boolean>> {
    if (this.isInteraction(this.context)) {
      if (!(this.context.replied || this.context.deferred)) throw new Error("Interaction not replied yet.");
      return await this.context.followUp(content as InteractionReplyOptions);
    } else if (this.isMessage(this.context)) {
      if (this.message) {
        (content as MessageCreateOptions).allowedMentions = { repliedUser: false }
        return await this.message.edit(content as MessagePayload);
      } else {
        (content as MessageCreateOptions).allowedMentions = { repliedUser: false }
        return await this.context.reply(content as MessageCreateOptions);
      }
    } else {
      throw new Error('Cannot followUp to the command context');
    }
  }

  async deferReply(content: MessageCreateOptions | MessagePayload | InteractionDeferReplyOptions ): Promise<InteractionResponse<boolean> | Message<boolean>> {
    if (this.isInteraction(this.context)) {
      if (!this.context.isRepliable()) throw new Error("Interaction has already been replied.");
      return await this.context.deferReply(content as InteractionDeferReplyOptions)
    } else if (this.isMessage(this.context)) {
      (content as MessageCreateOptions).content = "Shouko is thinking..";
      (content as MessageCreateOptions).allowedMentions = { repliedUser: false }
      this.message = await this.context.reply(content as MessageCreateOptions)
      return this.message;
    } else {
      throw new Error('Cannot editReply to the command context');
    }
  }

  async editReply(content: MessageCreateOptions | MessagePayload | InteractionEditReplyOptions ): Promise<Message<boolean>> {
    if (this.isInteraction(this.context)) {
      if (!(this.context.replied || this.context.deferred)) throw new Error("Interaction not replied yet.");
      return await this.context.editReply(content as InteractionEditReplyOptions);
    } else if (this.isMessage(this.context)) {
      if (!this.message) throw new Error("Interaction not replied yet.");
      (content as MessageCreateOptions).allowedMentions = { repliedUser: false }
      return await this.message.edit(content as MessagePayload);
    } else {
      throw new Error('Cannot editReply to the command context');
    }
  }
}

// Type-safe utility for converting arguments
type ParsedOptions = { [key: string]: CommandOptionValue };

function parseRawArgs(input: string): Array<string> {
  const regex = /\[\[(.*?)\]\]|(\S+)/g;
  const args = [];
  let match;

  while ((match = regex.exec(input)) !== null) {
    args.push(match[1] || match[2]);
  }

  return args;
}

const parseMessageArgs = (client: Client, args: string[], commandOptions: ApplicationCommandOptionData[]): ParsedOptions => {
  const options: ParsedOptions = {};

  try {
    (commandOptions as Array<ApplicationCommandOptionData>).forEach((option, index) => {
      const arg = args[index];

      if ((option as any).required && (arg === undefined || arg === null)) throw new Error("Missing required arguments: " + option.name)

      // Parse and store the argument based on the type defined in the command options
      switch (option.type) {
        case ApplicationCommandOptionType.User:
          {
            if (!arg) {
              options[option.name] = null;
              break;
            }
            const userId = arg.replace(/([^0-9]+)/g, "");
            const isValid = /^[0-9]+$/.test(userId);
            options[option.name] = isValid
              ? (client.users.cache.get(userId) ?? client.users.fetch(userId))
              : null;
          }
          break;
        case ApplicationCommandOptionType.Channel:
          const channelId = arg.replace(/([^0-9]+)/g, "");
          const isValid = /^[0-9]+$/.test(channelId);
          options[option.name] = isValid
            ? (client.channels.cache.get(channelId) ?? client.channels.fetch(channelId))
            : null;
        case ApplicationCommandOptionType.Boolean:
          options[option.name] = arg ? arg.toLowerCase() === "true" : false;
          break;
        case ApplicationCommandOptionType.String:
          options[option.name] = arg ?? null;
          break;
        case ApplicationCommandOptionType.Subcommand:
          options[option.name] = arg && arg.toLowerCase() === option.name ? true : null;
          break;
        default:
          options[option.name] = null;
          break;
      }
    });
  } catch(err: any) {
    return {};
  }

  return options;
};

export interface Command extends ChatInputApplicationCommandData, ShoukoCommand {
  run: (client: Client, interaction: ShoukoHybridCommand) => void,
  autocomplete?: (client: Client, interaction: AutocompleteInteraction) => void
}

export interface UserCommand extends UserApplicationCommandData, ShoukoCommand {
  run: (client: Client, interaction: ShoukoHybridCommand) => void
}

export interface MessageCommand extends MessageApplicationCommandData, ShoukoCommand {
  run: (client: Client, interaction: MessageContextMenuCommandInteraction) => void
}

export const UniversalContextType: InteractionContextType[] = [
  InteractionContextType.BotDM,
  InteractionContextType.Guild,
  InteractionContextType.PrivateChannel
]

export const UniversalIntegrationType: ApplicationIntegrationType[] = [
  ApplicationIntegrationType.GuildInstall,
  ApplicationIntegrationType.UserInstall
]

export const TranslateApplicationCommandOptionType: object = {
  "1": "Subcommand",
  "2": "SubcommandGroup",
  "3": "String",
  "4": "Integer",
  "5": "Boolean",
  "6": "User",
  "7": "Channel",
  "8": "Role",
  "9": "Mentionable",
  "10": "Number",
  "11": "Attachment"
}

export interface APIActionRequestResult {
  url: string;
  anime_name: string;
}
export interface APIActionResult {
  results: APIActionRequestResult[];
}
