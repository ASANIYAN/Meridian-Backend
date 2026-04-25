import { Test, TestingModule } from '@nestjs/testing';
import { ShareLinksService } from './share_links.service';

describe('ShareLinksService', () => {
  let service: ShareLinksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShareLinksService],
    }).compile();

    service = module.get<ShareLinksService>(ShareLinksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
