import { Test, TestingModule } from '@nestjs/testing';
import { ShareLinksController } from './share_links.controller';

describe('ShareLinksController', () => {
  let controller: ShareLinksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShareLinksController],
    }).compile();

    controller = module.get<ShareLinksController>(ShareLinksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
