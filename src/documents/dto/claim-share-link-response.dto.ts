export class ClaimShareLinkMembershipDto {
  id!: string;
  firstName!: string;
  lastName!: string;
  role!: 'editor' | 'viewer';
  membershipMode!: 'link';
  createdAt!: string;
}

export class ClaimShareLinkDocumentDto {
  id!: string;
  title!: string;
  status!: string;
  createdBy!: string;
  latestSnapshotId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class ClaimShareLinkResponseDataDto {
  membership!: ClaimShareLinkMembershipDto;
  document!: ClaimShareLinkDocumentDto;
}
