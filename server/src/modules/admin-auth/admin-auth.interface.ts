export interface AdminRegisterInput {
  username: string;
  password: string;
}

export interface AdminLoginInput {
  username: string;
  password: string;
}

export interface AdminChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface AdminAuthResult {
  accessToken: string;
  username: string;
}
