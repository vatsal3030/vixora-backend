const userSafeSelect = {
  id: true,
  fullName: true,
  email: true,
  username: true,
  avatar: true,
  coverImage: true,

  emailVerified: true,
  authProvider: true,

  createdAt: true,
  updatedAt: true,

  isDeleted:true,
  deletedAt:true,
};

export default userSafeSelect;
