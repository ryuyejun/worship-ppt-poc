package org.localchurch.worship.global.response;

/** JSON API의 공통 응답. 파일 다운로드는 별도의 바이너리 응답을 사용한다. */
public record ApiResponse<T>(boolean success, T data, String error) {
    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(true, data, null);
    }

    public static <T> ApiResponse<T> failure(String error) {
        return new ApiResponse<>(false, null, error);
    }
}
