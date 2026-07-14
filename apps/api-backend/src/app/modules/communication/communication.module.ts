import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { ConversationController } from './conversation.controller';
import { MessageController } from './message.controller';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../../common/storage/storage.module';

// Customer Communication Center (docs/features/customer-communication-center.md).
// Owns Conversation, ConversationMessage, ConversationRead. Services are
// exported for the DailySheet module's legacy note-endpoint adapters.
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [ConversationController, MessageController],
  providers: [ConversationService, MessageService],
  exports: [ConversationService, MessageService],
})
export class CommunicationModule {}
