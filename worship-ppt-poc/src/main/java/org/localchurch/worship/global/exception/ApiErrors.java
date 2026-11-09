package org.localchurch.worship.global.exception;

import org.localchurch.worship.global.response.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> invalidArgument(
            MethodArgumentNotValidException exception) {
        String message =
                exception.getBindingResult().getFieldErrors().stream()
                        .findFirst()
                        .map(error -> error.getDefaultMessage())
                        .orElse("입력값을 확인해 주세요.");
        return ResponseEntity.badRequest().body(ApiResponse.failure(message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> invalidJson(
            HttpMessageNotReadableException exception) {
        return ResponseEntity.badRequest().body(ApiResponse.failure("요청 형식을 확인해 주세요."));
    }

    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<ApiResponse<Void>> badRequest(Exception exception) {
        String message = exception.getMessage() == null ? "요청을 확인해 주세요." : exception.getMessage();
        return ResponseEntity.badRequest().body(ApiResponse.failure(message));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> serverError(Exception exception) {
        return ResponseEntity.internalServerError().body(ApiResponse.failure("처리 중 오류가 발생했습니다."));
    }
}
